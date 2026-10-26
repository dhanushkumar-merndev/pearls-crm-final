import { describe, expect, it } from "vitest";
import { copyFiles, exportDatabase, readCopy, recheckFolder, type BackupItem, type BackupServer, type Folder, type FolderFile } from "./backup";
import { sha256Hex } from "./sha256";

/** An in-memory folder with the File System Access calls the engine uses. */
class MemFolder implements Folder {
  dirs = new Map<string, MemFolder>();
  files = new Map<string, Blob>();
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Folder> {
    if (!this.dirs.has(name)) {
      if (!options?.create) throw new DOMException("missing", "NotFoundError");
      this.dirs.set(name, new MemFolder());
    }
    return this.dirs.get(name)!;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FolderFile> {
    if (!this.files.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
    return {
      getFile: async () => this.files.get(name)!,
      createWritable: async () => {
        const parts: (Blob | string)[] = [];
        return { write: async (d: Blob | string) => void parts.push(d), close: async () => void this.files.set(name, new Blob(parts)) };
      },
    };
  }
  /** Every file path, for counting. */
  all(prefix = ""): string[] {
    return [...[...this.files.keys()].map((f) => prefix + f), ...[...this.dirs].flatMap(([d, f]) => f.all(`${prefix}${d}/`))];
  }
}

const content = (i: number) => `recording number ${i}`;

/** A fake server with n files; it pages 2 at a time and keeps the database's rules. */
async function fakeServer(n: number, opts: { breakOn?: number; corruptOn?: number } = {}) {
  const items: (BackupItem & { verified: boolean; expected: string })[] = [];
  for (let i = 1; i <= n; i++) {
    const sha = await sha256Hex(new Blob([content(i)]));
    items.push({
      id: `item-${i}`, file_id: `file-${i}`, purpose: "call_recording", mime: "audio/mp4", size_bytes: content(i).length,
      created_at: `2026-10-0${i}T05:00:00Z`, sha256: sha, label: `Lead ${i}`, verified: false, expected: sha,
    });
  }
  const downloads: string[] = [];
  const marked: string[] = [];
  let broken = false;
  const server: BackupServer = {
    page: async (_b, after) => {
      const pending = items.filter((i) => !i.verified && (after === null || i.id > after)).slice(0, 2);
      const strip = (i: (typeof items)[number]): BackupItem => ({
        id: i.id, file_id: i.file_id, purpose: i.purpose, mime: i.mime, size_bytes: i.size_bytes, created_at: i.created_at, sha256: i.sha256, label: i.label,
      });
      return { items: pending.map(strip), next: pending.length === 2 ? pending[1]!.id : null };
    },
    urls: async (ids) => Object.fromEntries(ids.map((id) => [id, `https://files/${id}`])),
    download: async (url) => {
      const i = Number(url.split("-").at(-1));
      downloads.push(url);
      if (opts.breakOn === i && !broken) {
        broken = true;
        throw new Error("network");
      }
      return new Blob([opts.corruptOn === i ? "garbage" : content(i)]);
    },
    markVerified: async (_b, list) => {
      let verified = 0;
      let mismatched = 0;
      for (const v of list) {
        const item = items.find((i) => i.id === v.id)!;
        if (v.sha256 === item.expected) {
          item.verified = true;
          marked.push(v.id);
          verified++;
        } else mismatched++;
      }
      return { verified, mismatched, remaining: items.filter((i) => !i.verified).length };
    },
    failed: async () => undefined,
  };
  return { server, items, downloads, marked };
}

describe("backup centre: copying files", () => {
  it("copies every file to its own Windows-safe path and sends each checksum", async () => {
    const root = new MemFolder();
    const { server, items, marked } = await fakeServer(5);
    const out = await copyFiles(root, "b1", server, () => undefined);
    expect(out).toMatchObject({ done: 5, failed: 0 });
    expect(items.every((i) => i.verified)).toBe(true);
    expect(marked).toHaveLength(5);
    expect(root.all().sort()).toEqual([1, 2, 3, 4, 5].map((i) => `call_recording/2026-10/2026-10-0${i}_Lead ${i}_file-${i}.m4a`));
  });

  it("an interrupted backup resumes without duplicates or a second download", async () => {
    const root = new MemFolder();
    const { server, items, downloads, marked } = await fakeServer(5, { breakOn: 3 });
    const first = await copyFiles(root, "b1", server, () => undefined);
    expect(first).toMatchObject({ done: 4, failed: 1 });
    // The run stops (tab closed, network gone)… and is started again.
    const second = await copyFiles(root, "b1", server, () => undefined);
    expect(second).toMatchObject({ done: 1, failed: 0 });
    expect(items.every((i) => i.verified)).toBe(true);
    expect(root.all()).toHaveLength(5);
    expect(new Set(marked).size).toBe(marked.length);
    expect(downloads.filter((d) => d.endsWith("file-1"))).toHaveLength(1);
    expect(downloads.filter((d) => d.endsWith("file-3"))).toHaveLength(2);
  });

  it("a file already in the folder from an earlier run is not downloaded again", async () => {
    const root = new MemFolder();
    const one = await fakeServer(2);
    await copyFiles(root, "b1", one.server, () => undefined);
    // A new batch for the same files (e.g. the batch was abandoned): the copies are reused.
    const two = await fakeServer(2);
    for (const item of two.items) item.id = `other-${item.id}`;
    await copyFiles(root, "b2", two.server, () => undefined);
    expect(two.downloads).toHaveLength(0);
    expect(two.items.every((i) => i.verified)).toBe(true);
  });

  it("stops between files when asked, and the rest is still pending", async () => {
    const root = new MemFolder();
    const { server, items } = await fakeServer(5);
    const stop = new AbortController();
    await copyFiles(root, "b1", server, (p) => p.done >= 2 && stop.abort(), stop.signal);
    expect(items.filter((i) => i.verified)).toHaveLength(2);
  });

  it("a download that doesn't match the stored checksum is not counted as backed up", async () => {
    const root = new MemFolder();
    const { server, items } = await fakeServer(3, { corruptOn: 2 });
    const out = await copyFiles(root, "b1", server, () => undefined);
    expect(out).toMatchObject({ done: 2, failed: 1 });
    expect(items.find((i) => i.id === "item-2")!.verified).toBe(false);
  });
});

describe("backup centre: checking the folder", () => {
  it("finds a corrupted copy and a missing one", async () => {
    const root = new MemFolder();
    const { server } = await fakeServer(3);
    await copyFiles(root, "b1", server, () => undefined);
    const paths = root.all();
    // Someone edits one file and deletes another.
    const month = (root.dirs.get("call_recording")!.dirs.get("2026-10"))!;
    const [first, second] = [...month.files.keys()];
    month.files.set(first!, new Blob(["changed"]));
    month.files.delete(second!);
    const seen: { id: string; sha256: string | null }[] = [];
    const out = await recheckFolder(root, "b1", {
      page: async () => ({ items: await Promise.all(paths.map(async (p, i) => ({ id: `item-${i + 1}`, path: p, sha256: "" }))), next: null }),
      recheck: async (_b, list) => {
        seen.push(...list);
        const good = await Promise.all(list.map(async (x, i) => x.sha256 === (await sha256Hex(new Blob([content(i + 1)]))) && x.sha256 !== null));
        return { ok: good.filter(Boolean).length, bad: good.filter((g) => !g).length };
      },
    }, () => undefined);
    expect(out).toEqual({ ok: 1, bad: 2 });
    expect(seen.filter((s) => s.sha256 === null)).toHaveLength(1);
  });
});

describe("backup centre: database export", () => {
  it("writes one JSON Lines file per table across pages, a manifest, and records it", async () => {
    const root = new MemFolder();
    let recorded: { table: string; rows: number; sha256: string }[] = [];
    const out = await exportDatabase(root, "2026-10-26 10-00", {
      tables: async () => [{ table: "patients", rows: 3 }, { table: "empty_table", rows: 0 }],
      page: async (table, after) =>
        table === "empty_table" ? { rows: [], next: null }
        : after === null ? { rows: [{ id: 1, name: "A" }, { id: 2, name: "B" }], next: "(0,2)" } : { rows: [{ id: 3, name: "C" }], next: null },
      record: async (_s, tables) => void (recorded = tables),
    }, () => undefined);
    expect(out.map((t) => [t.table, t.rows])).toEqual([["patients", 3], ["empty_table", 0]]);
    const file = await readCopy(root, ["database", "2026-10-26 10-00", "patients.jsonl"]);
    expect((await file!.text()).trim().split("\n").map((l) => JSON.parse(l).name)).toEqual(["A", "B", "C"]);
    expect(recorded[0]!.sha256).toBe(await sha256Hex(file!));
    expect(await readCopy(root, ["database", "2026-10-26 10-00", "manifest.json"])).not.toBeNull();
  });
});
