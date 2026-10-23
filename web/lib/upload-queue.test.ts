import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  allJobs, closeScanDb, enqueue, getJob, jobsFor, releaseJob, retryPause, runQueue, type NewJob, type QueueDeps,
} from "./upload-queue";

const PATIENT = "11111111-0000-4000-a000-000000000001";

function job(over: Partial<NewJob> = {}): NewJob {
  return {
    patientId: PATIENT,
    title: "Prescription",
    kindId: null,
    docDate: "2026-10-23",
    pageCount: 2,
    reuseFileId: null,
    sourceSha256: ["a".repeat(64)],
    discardFileIds: [],
    scanSessionId: null,
    checkDuplicate: true,
    file: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])], { type: "application/pdf" }),
    thumb: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9])], { type: "image/jpeg" }),
    ...over,
  };
}

/** A fake server: records calls; can be "offline" or fail a number of times. */
function fakeDeps(over: Partial<QueueDeps> & { failUploads?: number; failWith?: string } = {}) {
  let clock = 1_000_000;
  let failures = over.failUploads ?? 0;
  const calls: string[] = [];
  const uploads: { purpose: string; clientId: string; size: number; type: string }[] = [];
  const documents: { doc: Record<string, unknown>; clientId: string }[] = [];
  const deps: QueueDeps = {
    online: () => true,
    now: () => clock,
    findDuplicate: async () => (calls.push("findDuplicate"), null),
    upload: async (file, purpose, _patient, clientId) => {
      calls.push(`upload ${purpose}`);
      if (failures > 0) {
        failures--;
        throw Object.assign(new Error(over.failWith ?? "unknown"), { code: over.failWith ?? "unknown" });
      }
      uploads.push({ purpose, clientId, size: file.size, type: file.type });
      return `file-${clientId}`;
    },
    createDocument: async (doc, clientId) => void (calls.push("createDocument"), documents.push({ doc, clientId })),
    discard: async (ids) => void calls.push(`discard ${ids.join(",")}`),
    closeScan: async (id) => void calls.push(`closeScan ${id}`),
    ...over,
  };
  return { deps, calls, uploads, documents, tick: (ms: number) => (clock += ms) };
}

beforeEach(async () => {
  await closeScanDb();
  indexedDB.deleteDatabase("pearl-scan");
});

describe("upload queue (IndexedDB)", () => {
  it("keeps a saved scan, with its bytes, across a reload", async () => {
    const queued = await enqueue(job());
    await closeScanDb(); // what a page reload does to the open connection
    const [again] = await jobsFor(PATIENT);
    expect(again!.id).toBe(queued.id);
    expect(again!.state).toBe("waiting");
    expect(new Uint8Array(again!.file!.bytes)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]));
    expect(again!.file!.mime).toBe("application/pdf");
  });

  it("does nothing while offline, uploads once back online", async () => {
    const queued = await enqueue(job({ discardFileIds: ["p1", "p2"], scanSessionId: "s1" }));
    const offline = fakeDeps({ online: () => false });
    await runQueue(offline.deps);
    expect(offline.calls).toEqual([]);
    expect(await allJobs()).toHaveLength(1);

    const online = fakeDeps();
    expect(await runQueue(online.deps)).toBeNull();
    expect(online.calls).toEqual(["findDuplicate", "upload document", "upload thumbnail", "createDocument", "discard p1,p2", "closeScan s1"]);
    expect(online.documents).toEqual([
      {
        clientId: queued.id,
        doc: {
          patient_id: PATIENT,
          file_id: `file-${queued.fileClientId}`,
          thumbnail_file_id: `file-${queued.thumbClientId}`,
          kind_id: null,
          title: "Prescription",
          doc_date: "2026-10-23",
          page_count: 2,
          source_sha256: ["a".repeat(64)],
        },
      },
    ]);
    expect(online.uploads[0]).toMatchObject({ purpose: "document", type: "application/pdf", size: 8 });
    expect(await allJobs()).toEqual([]);
  });

  it("a dropped connection is retried later with the same ids (never a second copy)", async () => {
    const queued = await enqueue(job());
    const flaky = fakeDeps({ failUploads: 1 });
    const nextAt = await runQueue(flaky.deps);
    const waiting = await getJob(queued.id);
    expect(waiting).toMatchObject({ state: "waiting", attempts: 1, error: "unknown" });
    expect(nextAt).toBe(waiting!.nextAttemptAt);
    expect(nextAt!).toBeGreaterThan(flaky.deps.now());

    await runQueue(flaky.deps); // not due yet: nothing happens
    expect(flaky.calls.filter((c) => c === "upload document")).toHaveLength(1);

    flaky.tick(10 * 60_000);
    await runQueue(flaky.deps);
    expect(flaky.uploads.map((u) => u.clientId)).toEqual([queued.fileClientId, queued.thumbClientId]);
    expect(flaky.documents).toHaveLength(1);
    expect(await allJobs()).toEqual([]);
  });

  it("coming back online retries at once (force)", async () => {
    await enqueue(job());
    const flaky = fakeDeps({ failUploads: 1 });
    await runQueue(flaky.deps);
    await runQueue(flaky.deps, { force: true });
    expect(flaky.documents).toHaveLength(1);
  });

  it("an upload interrupted by a reload is picked up again", async () => {
    const queued = await enqueue(job({ checkDuplicate: false }));
    const { saveJob } = await import("./upload-queue");
    await saveJob({ ...(await getJob(queued.id))!, state: "uploading", fileId: "file-already-there" });
    const { deps, calls } = fakeDeps();
    await runQueue(deps);
    expect(calls).toEqual(["upload thumbnail", "createDocument"]); // the document file is not sent twice
  });

  it("a duplicate waits for a person: save anyway, or remove", async () => {
    const queued = await enqueue(job());
    const dup = fakeDeps({ findDuplicate: async () => ({ title: "Old prescription", doc_date: "2026-10-01" }) });
    await runQueue(dup.deps);
    expect(await getJob(queued.id)).toMatchObject({ state: "duplicate", duplicateOf: { title: "Old prescription" } });
    expect(dup.uploads).toEqual([]);

    await runQueue(dup.deps, { force: true }); // still waiting for the person
    expect(dup.uploads).toEqual([]);

    await releaseJob(queued.id, { skipDuplicateCheck: true });
    await runQueue(dup.deps);
    expect(dup.documents).toHaveLength(1);
  });

  it("a refused file is not retried by itself", async () => {
    const queued = await enqueue(job());
    const refused = fakeDeps({ failUploads: 5, failWith: "file_too_large" });
    await runQueue(refused.deps);
    expect(await getJob(queued.id)).toMatchObject({ state: "failed", error: "file_too_large" });
    refused.tick(60 * 60_000);
    await runQueue(refused.deps);
    expect(refused.calls.filter((c) => c === "upload document")).toHaveLength(1);
  });

  it("an unchanged phone page is used as it is (no second upload)", async () => {
    await enqueue(job({ file: null, reuseFileId: "phone-page-1", thumb: null, checkDuplicate: false }));
    const { deps, calls, documents } = fakeDeps();
    await runQueue(deps);
    expect(calls).toEqual(["createDocument"]);
    expect(documents[0]!.doc.file_id).toBe("phone-page-1");
  });

  it("pauses grow and stop at 5 minutes", () => {
    expect(retryPause(1, 0.5)).toBe(5000);
    expect(retryPause(3, 0.5)).toBe(20000);
    expect(retryPause(20, 0.5)).toBe(300000);
  });
});
