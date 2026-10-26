/**
 * Backup centre engine (PLAN.md E3 row 14): copies files into a folder the admin picked
 * (Chrome / Edge File System Access), re-reads each copy and sends its SHA-256 to the server,
 * re-checks a finished backup, and writes a full database export. The server and the folder
 * are passed in, so tests run against fakes.
 *
 * Resuming never duplicates: the server hands back the same unfinished batch, each file always
 * gets the same path (backupPath), and a copy already in the folder with the right checksum is
 * not downloaded again.
 */
import { backupPath, exportPath } from "@pearl/shared";
import { sha256Hex } from "./sha256";

/** The parts of FileSystemDirectoryHandle / FileSystemFileHandle we use. */
export interface Folder {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Folder>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FolderFile>;
}
export interface FolderFile {
  getFile(): Promise<Blob>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}

export interface BackupItem {
  id: string;
  file_id: string;
  purpose: string;
  mime: string;
  size_bytes: number;
  created_at: string;
  sha256: string | null;
  label: string | null;
}

export interface BackupServer {
  page(batchId: string, after: string | null): Promise<{ items: BackupItem[]; next: string | null }>;
  urls(fileIds: string[]): Promise<Record<string, string>>;
  download(url: string): Promise<Blob>;
  markVerified(batchId: string, items: { id: string; sha256: string; path: string }[]): Promise<{ verified: number; mismatched: number; remaining: number }>;
  failed(batchId: string, itemId: string, error: string): Promise<void>;
}

export interface Progress {
  done: number;
  bytes: number;
  failed: number;
}

async function folderAt(root: Folder, dirs: string[], create: boolean): Promise<Folder> {
  let dir = root;
  for (const name of dirs) dir = await dir.getDirectoryHandle(name, { create });
  return dir;
}

/** The copy at this path, or null when it isn't there. */
export async function readCopy(root: Folder, path: string[]): Promise<Blob | null> {
  try {
    const dir = await folderAt(root, path.slice(0, -1), false);
    return await (await dir.getFileHandle(path.at(-1)!)).getFile();
  } catch {
    return null;
  }
}

async function writeCopy(root: Folder, path: string[], data: Blob | string): Promise<void> {
  const dir = await folderAt(root, path.slice(0, -1), true);
  const writable = await (await dir.getFileHandle(path.at(-1)!, { create: true })).createWritable();
  await writable.write(data);
  await writable.close();
}

/** Copies every file still pending in the batch. Stops early (between files) when `signal` aborts. */
export async function copyFiles(
  root: Folder,
  batchId: string,
  server: BackupServer,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<Progress> {
  const progress: Progress = { done: 0, bytes: 0, failed: 0 };
  let after: string | null = null;
  do {
    const page = await server.page(batchId, after);
    after = page.next;
    if (page.items.length === 0) break;
    const urls = await server.urls(page.items.map((i) => i.file_id));
    const verified: { id: string; sha256: string; path: string }[] = [];
    for (const item of page.items) {
      if (signal?.aborted) break;
      // Named by the file (not the batch item), so every batch puts it in the same place.
      const path = backupPath({ ...item, id: item.file_id });
      try {
        // Already copied by an earlier, interrupted run? Then only its checksum is sent.
        const existing = item.sha256 ? await readCopy(root, path) : null;
        if (!(existing && (await sha256Hex(existing)) === item.sha256)) {
          const url = urls[item.file_id];
          if (!url) throw new Error("no_link");
          await writeCopy(root, path, await server.download(url));
        }
        // Read back what is on disk: that is what the checksum vouches for.
        const copy = await readCopy(root, path);
        if (!copy) throw new Error("not_written");
        verified.push({ id: item.id, sha256: await sha256Hex(copy), path: path.join("/") });
        progress.bytes += copy.size;
      } catch (e) {
        progress.failed++;
        await server.failed(batchId, item.id, e instanceof Error ? e.message : "failed");
      }
    }
    if (verified.length) {
      const res = await server.markVerified(batchId, verified);
      progress.done += res.verified;
      progress.failed += res.mismatched;
    }
    onProgress({ ...progress });
    if (signal?.aborted) break;
  } while (after);
  return progress;
}

export interface RecheckServer {
  page(batchId: string, after: string | null): Promise<{ items: { id: string; path: string; sha256: string }[]; next: string | null }>;
  recheck(batchId: string, items: { id: string; sha256: string | null }[]): Promise<{ ok: number; bad: number }>;
}

/** Re-reads every verified copy of a batch; the server un-marks any that changed or went missing. */
export async function recheckFolder(root: Folder, batchId: string, server: RecheckServer, onProgress: (n: number) => void) {
  const total = { ok: 0, bad: 0 };
  let after: string | null = null;
  do {
    const page = await server.page(batchId, after);
    after = page.next;
    const found: { id: string; sha256: string | null }[] = [];
    for (const item of page.items) {
      const copy = await readCopy(root, item.path.split("/"));
      found.push({ id: item.id, sha256: copy ? await sha256Hex(copy) : null });
    }
    if (found.length) {
      const res = await server.recheck(batchId, found);
      total.ok += res.ok;
      total.bad += res.bad;
    }
    onProgress(total.ok + total.bad);
  } while (after);
  return total;
}

export interface ExportServer {
  tables(): Promise<{ table: string; rows: number }[]>;
  page(table: string, after: string | null): Promise<{ rows: unknown[]; next: string | null }>;
  record(stamp: string, tables: { table: string; rows: number; bytes: number; sha256: string; path: string }[]): Promise<unknown>;
}

/** Every table as JSON Lines (one row per line) under database/<stamp>/, plus a manifest. */
export async function exportDatabase(root: Folder, stamp: string, server: ExportServer, onProgress: (table: string, n: number, of: number) => void) {
  const tables = await server.tables();
  const done: { table: string; rows: number; bytes: number; sha256: string; path: string }[] = [];
  for (const [i, { table }] of tables.entries()) {
    onProgress(table, i, tables.length);
    const lines: string[] = [];
    let after: string | null = null;
    do {
      const page = await server.page(table, after);
      for (const row of page.rows) lines.push(JSON.stringify(row));
      after = page.next;
    } while (after);
    const path = exportPath(stamp, table);
    await writeCopy(root, path, lines.length ? `${lines.join("\n")}\n` : "");
    const copy = await readCopy(root, path);
    if (!copy) throw new Error("not_written");
    done.push({ table, rows: lines.length, bytes: copy.size, sha256: await sha256Hex(copy), path: path.join("/") });
  }
  await writeCopy(root, [...exportPath(stamp, "x").slice(0, -1), "manifest.json"], JSON.stringify({ stamp, tables: done }, null, 2));
  await server.record(stamp, done);
  onProgress("", tables.length, tables.length);
  return done;
}
