/**
 * Offline-safe upload queue for scanned documents (PLAN.md E3 phase 8). A saved scan is
 * kept in IndexedDB (in this browser only) until it is uploaded, so it survives a reload
 * and a lost connection; it is retried with growing pauses and at once when the browser
 * comes back online. Every step is idempotent (client-made ids for the files and the
 * document), so a retry — or two tabs — can never save the document twice.
 */
import { ERROR_CODES } from "@pearl/shared";

export type JobState = "waiting" | "uploading" | "duplicate" | "failed";

export interface UploadJob {
  /** Also the document's id (create_document is idempotent on it). */
  id: string;
  patientId: string;
  createdAt: number;
  title: string;
  kindId: string | null;
  docDate: string;
  pageCount: number;
  /** The document file; null when an unchanged phone page is used as it is. */
  file: { bytes: ArrayBuffer; mime: string } | null;
  reuseFileId: string | null;
  thumb: { bytes: ArrayBuffer; mime: string } | null;
  sourceSha256: string[];
  fileClientId: string;
  thumbClientId: string;
  /** Progress, so a retry continues where it stopped. */
  fileId: string | null;
  thumbId: string | null;
  discardFileIds: string[];
  scanSessionId: string | null;
  checkDuplicate: boolean;
  state: JobState;
  attempts: number;
  nextAttemptAt: number;
  error: string | null;
  duplicateOf: { title: string; doc_date: string } | null;
}

export interface QueueDeps {
  online(): boolean;
  now(): number;
  findDuplicate(patientId: string, sha256: string[]): Promise<{ title: string; doc_date: string } | null>;
  /** Uploads one private file (files-sign put → PUT → confirm); returns the file id. */
  upload(file: Blob, purpose: "document" | "thumbnail", patientId: string, clientId: string): Promise<string>;
  createDocument(doc: Record<string, unknown>, clientId: string): Promise<void>;
  discard(fileIds: string[]): Promise<void>;
  closeScan(sessionId: string): Promise<void>;
}

// Network trouble, an expired login (the person logs in again) or a busy server: try
// again later. Anything else (too big, wrong type, not allowed…) needs a person.
const RETRYABLE = new Set(["unknown", "upload_incomplete", "rate_limited", "not_signed_in"]);
const MAX_PAUSE_MS = 5 * 60_000;

export function errorCode(e: unknown): string {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  if ((ERROR_CODES as readonly string[]).includes(code)) return code;
  const message = e instanceof Error ? e.message : String(e);
  return (ERROR_CODES as readonly string[]).includes(message) ? message : "unknown";
}

/** 5 s, 10 s, 20 s … up to 5 minutes, with a little jitter so tabs don't retry in step. */
export function retryPause(attempts: number, random: number = Math.random()): number {
  return Math.min(MAX_PAUSE_MS, 5000 * 2 ** Math.max(0, attempts - 1)) * (0.9 + random * 0.2);
}

// ---------------------------------------------------------------------------------------
// Storage (IndexedDB)
// ---------------------------------------------------------------------------------------
const DB_NAME = "pearl-scan";
const JOBS = "jobs";
export const KV = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openScanDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(JOBS, { keyPath: "id" }).createIndex("patient", "patientId");
      db.createObjectStore(KV);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("indexeddb_unavailable"));
    };
  });
  return dbPromise;
}

/** For tests: forget the open connection (as a page reload would). */
export async function closeScanDb() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode: IDBTransactionMode, name = JOBS): Promise<IDBObjectStore> {
  return (await openScanDb()).transaction(name, mode).objectStore(name);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return request((await store("readonly", KV)).get(key)) as Promise<T | undefined>;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await request((await store("readwrite", KV)).put(value, key));
}

// Change notices: this tab's listeners and, through a BroadcastChannel, the other tabs.
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
function broadcast() {
  for (const l of listeners) l();
  try {
    channel ??= new BroadcastChannel("pearl-upload-queue");
    channel.postMessage("changed");
  } catch {
    // no BroadcastChannel: other tabs see the change on their next refresh
  }
}
export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  let own: BroadcastChannel | null = null;
  try {
    own = new BroadcastChannel("pearl-upload-queue");
    own.onmessage = () => listener();
  } catch {
    own = null;
  }
  return () => {
    listeners.delete(listener);
    own?.close();
  };
}

export async function saveJob(job: UploadJob): Promise<void> {
  await request((await store("readwrite")).put(job));
  broadcast();
}
export async function getJob(id: string): Promise<UploadJob | undefined> {
  return request((await store("readonly")).get(id)) as Promise<UploadJob | undefined>;
}
export async function deleteJob(id: string): Promise<void> {
  await request((await store("readwrite")).delete(id));
  broadcast();
}
export async function jobsFor(patientId: string): Promise<UploadJob[]> {
  const all = (await request((await store("readonly")).index("patient").getAll(patientId))) as UploadJob[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
export async function allJobs(): Promise<UploadJob[]> {
  const all = (await request((await store("readonly")).getAll())) as UploadJob[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export type NewJob = Pick<
  UploadJob,
  "patientId" | "title" | "kindId" | "docDate" | "pageCount" | "reuseFileId" | "sourceSha256" | "discardFileIds" | "scanSessionId" | "checkDuplicate"
> & { file: Blob | null; thumb: Blob | null; id?: string };

export async function enqueue(job: NewJob, now: number = Date.now()): Promise<UploadJob> {
  const full: UploadJob = {
    ...job,
    id: job.id ?? crypto.randomUUID(),
    createdAt: now,
    file: job.file ? { bytes: await job.file.arrayBuffer(), mime: job.file.type } : null,
    thumb: job.thumb ? { bytes: await job.thumb.arrayBuffer(), mime: job.thumb.type } : null,
    fileClientId: crypto.randomUUID(),
    thumbClientId: crypto.randomUUID(),
    fileId: null,
    thumbId: null,
    state: "waiting",
    attempts: 0,
    nextAttemptAt: 0,
    error: null,
    duplicateOf: null,
  };
  await saveJob(full);
  return full;
}

/** "Try again" on a failed upload, or "Save anyway" on a duplicate. */
export async function releaseJob(id: string, { skipDuplicateCheck = false } = {}): Promise<void> {
  const job = await getJob(id);
  if (!job) return;
  await saveJob({
    ...job,
    state: "waiting",
    nextAttemptAt: 0,
    error: null,
    ...(skipDuplicateCheck ? { checkDuplicate: false, duplicateOf: null } : {}),
  });
}

// ---------------------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------------------
export type Outcome = "done" | "duplicate" | "retry" | "failed";

export async function processJob(job: UploadJob, deps: QueueDeps): Promise<Outcome> {
  let current: UploadJob = { ...job, state: "uploading" };
  const save = async (patch: Partial<UploadJob>) => {
    current = { ...current, ...patch };
    await saveJob(current);
  };
  try {
    await save({});
    if (current.checkDuplicate) {
      const dup = await deps.findDuplicate(current.patientId, current.sourceSha256);
      if (dup) {
        await save({ state: "duplicate", duplicateOf: dup });
        return "duplicate";
      }
      await save({ checkDuplicate: false });
    }
    if (!current.fileId) {
      const fileId =
        current.reuseFileId ??
        (await deps.upload(new Blob([current.file!.bytes], { type: current.file!.mime }), "document", current.patientId, current.fileClientId));
      await save({ fileId });
    }
    if (current.thumb && !current.thumbId) {
      try {
        const thumbId = await deps.upload(new Blob([current.thumb.bytes], { type: current.thumb.mime }), "thumbnail", current.patientId, current.thumbClientId);
        await save({ thumbId });
      } catch (e) {
        if (RETRYABLE.has(errorCode(e))) throw e;
        await save({ thumb: null }); // a refused preview picture never blocks the document
      }
    }
    await deps.createDocument(
      {
        patient_id: current.patientId,
        file_id: current.fileId,
        thumbnail_file_id: current.thumbId,
        kind_id: current.kindId,
        title: current.title,
        doc_date: current.docDate,
        page_count: current.pageCount,
        source_sha256: current.sourceSha256,
      },
      current.id,
    );
    // Tidy-up never blocks: the document is saved.
    await Promise.allSettled([
      current.discardFileIds.length ? deps.discard(current.discardFileIds) : Promise.resolve(),
      current.scanSessionId ? deps.closeScan(current.scanSessionId) : Promise.resolve(),
    ]);
    await deleteJob(current.id);
    return "done";
  } catch (e) {
    const code = errorCode(e);
    if (RETRYABLE.has(code)) {
      const attempts = current.attempts + 1;
      await save({ state: "waiting", attempts, error: code, nextAttemptAt: deps.now() + retryPause(attempts) });
      return "retry";
    }
    await save({ state: "failed", error: code });
    return "failed";
  }
}

/** Uploads every job that is due, one at a time. Returns when the next retry is due (or null). */
export async function runQueue(deps: QueueDeps, { force = false } = {}): Promise<number | null> {
  if (!deps.online()) return null;
  for (const job of await allJobs()) {
    // "uploading" here means a reload or crash interrupted it: pick it up again.
    const due = job.state === "uploading" || (job.state === "waiting" && (force || job.nextAttemptAt <= deps.now()));
    if (!due) continue;
    const outcome = await processJob(job, deps);
    if (outcome === "retry" && !deps.online()) break;
  }
  const waiting = (await allJobs()).filter((j) => j.state === "waiting").map((j) => j.nextAttemptAt);
  return waiting.length ? Math.min(...waiting) : null;
}
