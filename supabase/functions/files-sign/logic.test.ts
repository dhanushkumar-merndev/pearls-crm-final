// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import type { StorageAdapter } from "../_shared/storage.ts";
import { type Deps, filesSign } from "./logic.ts";

const FILE = "22222222-0000-4000-a000-000000000001";
const webpHead = new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8 "].map((c) => c.charCodeAt(0)), [0, 0, 0, 0]));

function fakeDeps(over: {
  rpc?: Record<string, { data?: unknown; error?: { message: string } | null }>;
  file?: { object_key: string; mime: string; size_bytes: number; status: string } | null;
  head?: { size: number; contentType: string | null } | null;
  bytes?: Uint8Array;
} = {}) {
  const calls: string[] = [];
  const storage: StorageAdapter = {
    presignPut: async (key, ct) => (calls.push(`presignPut ${key} ${ct}`), `https://s3/${key}?sig`),
    presignGet: async (key) => (calls.push(`presignGet ${key}`), `https://s3/${key}?get`),
    head: async () => over.head ?? null,
    readRange: async () => over.bytes ?? webpHead,
    remove: async (key) => void calls.push(`remove ${key}`),
  };
  const deps: Deps = {
    rpc: async (fn, _args) => {
      calls.push(`rpc ${fn}`);
      const r = over.rpc?.[fn] ?? { data: null, error: null };
      return { data: (r.data ?? null) as never, error: r.error ?? null };
    },
    ownFile: async () => over.file === undefined ? null : over.file,
    storage,
  };
  return { deps, calls };
}

Deno.test("put: returns a signed upload link after the RPC approves", async () => {
  const { deps, calls } = fakeDeps({
    rpc: { files_begin_upload: { data: { file_id: FILE, object_key: "prescription/2026/10/x.webp", status: "pending" } } },
  });
  const res = await filesSign({ op: "put", purpose: "prescription", mime: "image/webp", size: 1000 }, deps);
  assertEquals(res.status, 200);
  assertEquals((res.body.upload as { url: string }).url, "https://s3/prescription/2026/10/x.webp?sig");
  assertEquals(calls, ["rpc files_begin_upload", "presignPut prescription/2026/10/x.webp image/webp"]);
});

Deno.test("put: a refused upload never gets a link", async () => {
  const { deps, calls } = fakeDeps({ rpc: { files_begin_upload: { error: { message: "not_allowed" } } } });
  const res = await filesSign({ op: "put", purpose: "call_recording", mime: "audio/ogg", size: 10 }, deps);
  assertEquals(res, { status: 403, body: { error: "not_allowed" } });
  assertEquals(calls, ["rpc files_begin_upload"]);
});

Deno.test("put: rejects malformed requests", async () => {
  const { deps } = fakeDeps();
  assertEquals((await filesSign({ op: "put", purpose: "x", mime: "y", size: -1 }, deps)).body, { error: "invalid_input" });
  assertEquals((await filesSign({ op: "nope" }, deps)).body, { error: "invalid_input" });
  assertEquals((await filesSign(null, deps)).body, { error: "invalid_input" });
});

Deno.test("confirm: right size and real type → uploaded", async () => {
  const { deps, calls } = fakeDeps({
    file: { object_key: "k.webp", mime: "image/webp", size_bytes: 1000, status: "pending" },
    head: { size: 1000, contentType: "image/webp" },
  });
  const res = await filesSign({ op: "confirm", file_id: FILE }, deps);
  assertEquals(res.body, { file_id: FILE, status: "uploaded" });
  assertEquals(calls, ["rpc files_mark_uploaded"]);
});

Deno.test("confirm: a renamed file is deleted and marked failed", async () => {
  const html = new Uint8Array([..."<!doctype html><p>"].map((c) => c.charCodeAt(0)));
  const { deps, calls } = fakeDeps({
    file: { object_key: "k.webp", mime: "image/webp", size_bytes: 1000, status: "pending" },
    head: { size: 1000, contentType: "image/webp" },
    bytes: html,
  });
  const res = await filesSign({ op: "confirm", file_id: FILE }, deps);
  assertEquals(res.body, { error: "file_type_not_allowed" });
  assertEquals(calls, ["remove k.webp", "rpc files_mark_failed"]);
});

Deno.test("confirm: missing or wrong-size object is refused", async () => {
  const missing = fakeDeps({ file: { object_key: "k", mime: "image/webp", size_bytes: 10, status: "pending" }, head: null });
  assertEquals((await filesSign({ op: "confirm", file_id: FILE }, missing.deps)).body, { error: "upload_incomplete" });
  const bigger = fakeDeps({
    file: { object_key: "k", mime: "image/webp", size_bytes: 10, status: "pending" },
    head: { size: 9_000_000, contentType: null },
  });
  assertEquals((await filesSign({ op: "confirm", file_id: FILE }, bigger.deps)).body, { error: "upload_incomplete" });
  assertEquals(bigger.calls, ["remove k", "rpc files_mark_failed"]);
});

Deno.test("confirm: someone else's file is not found", async () => {
  const { deps } = fakeDeps({ file: null });
  assertEquals(await filesSign({ op: "confirm", file_id: FILE }, deps), { status: 404, body: { error: "not_found" } });
});

Deno.test("get: signs only what RLS returned", async () => {
  const other = "22222222-0000-4000-a000-000000000002";
  const { deps } = fakeDeps({ rpc: { files_viewable: { data: [{ id: FILE, object_key: "a.pdf" }] } } });
  const res = await filesSign({ op: "get", file_ids: [FILE, other] }, deps);
  assertEquals(res.body.urls, { [FILE]: "https://s3/a.pdf?get" });
});

Deno.test("discard: removes only what the database released", async () => {
  const other = "22222222-0000-4000-a000-000000000002";
  const { deps, calls } = fakeDeps({ rpc: { files_discard: { data: [{ id: FILE, object_key: "document/p1.jpg" }] } } });
  const res = await filesSign({ op: "discard", file_ids: [FILE, other] }, deps);
  assertEquals(res.body, { removed: [FILE] });
  assertEquals(calls, ["rpc files_discard", "remove document/p1.jpg"]);
});

Deno.test("discard: a refused call removes nothing", async () => {
  const { deps, calls } = fakeDeps({ rpc: { files_discard: { error: { message: "not_allowed" } } } });
  const res = await filesSign({ op: "discard", file_ids: [FILE] }, deps);
  assertEquals(res, { status: 403, body: { error: "not_allowed" } });
  assertEquals(calls, ["rpc files_discard"]);
});

Deno.test("purge: removes the objects the database released after checking the backup", async () => {
  const { deps, calls } = fakeDeps({ rpc: { files_purge: { data: [{ id: FILE, object_key: "call_recording/r1.m4a" }] } } });
  const res = await filesSign({ op: "purge", file_ids: [FILE] }, deps);
  assertEquals(res.body, { removed: [FILE] });
  assertEquals(calls, ["rpc files_purge", "remove call_recording/r1.m4a"]);
});

Deno.test("purge: without a verified backup nothing is removed", async () => {
  const { deps, calls } = fakeDeps({ rpc: { files_purge: { error: { message: "not_backed_up" } } } });
  const res = await filesSign({ op: "purge", file_ids: [FILE] }, deps);
  assertEquals(res, { status: 400, body: { error: "not_backed_up" } });
  assertEquals(calls, ["rpc files_purge"]);
});
