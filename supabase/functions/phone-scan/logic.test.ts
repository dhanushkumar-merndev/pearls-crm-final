// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import type { StorageAdapter } from "../_shared/storage.ts";
import { type Deps, phoneScan } from "./logic.ts";

const TOKEN = "ab".repeat(24);
const KEY = "cd".repeat(32);
const FILE = "22222222-0000-4000-a000-000000000001";
const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(12).fill(0)]);

function fakeDeps(over: {
  rpc?: Record<string, { data?: unknown; error?: { message: string } | null }>;
  head?: { size: number; contentType: string | null } | null;
  bytes?: Uint8Array;
} = {}) {
  const calls: string[] = [];
  const storage: StorageAdapter = {
    presignPut: async (key, ct) => (calls.push(`presignPut ${key} ${ct}`), `https://s3/${key}?sig`),
    presignGet: async (key) => `https://s3/${key}?get`,
    head: async () => over.head === undefined ? { size: 1000, contentType: "image/jpeg" } : over.head,
    readRange: async () => over.bytes ?? jpegHead,
    remove: async (key) => void calls.push(`remove ${key}`),
  };
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push(fn === "phone_scan_finish_upload" ? `rpc ${fn} ok=${args.p_ok}` : `rpc ${fn}`);
      const r = over.rpc?.[fn] ?? { data: null, error: null };
      return { data: (r.data ?? null) as never, error: r.error ?? null };
    },
    storage,
  };
  return { deps, calls };
}

const pendingFile = { object_key: "document/2026/10/p.jpg", mime: "image/jpeg", size_bytes: 1000, status: "pending" };
const open = { action: "open", token: TOKEN, device_key: KEY };
const put = { action: "put", token: TOKEN, device_key: KEY, mime: "image/jpeg", size: 1000, client_id: FILE };
const confirm = { action: "confirm", token: TOKEN, device_key: KEY, file_id: FILE };

Deno.test("open: the database decides; a second phone gets link_used, an old link link_expired", async () => {
  const ok = fakeDeps({ rpc: { phone_scan_open: { data: { session_id: "s", page_count: 0 } } } });
  assertEquals(await phoneScan(open, ok.deps), { status: 200, body: { session_id: "s", page_count: 0 } });
  const used = fakeDeps({ rpc: { phone_scan_open: { error: { message: "link_used" } } } });
  assertEquals(await phoneScan(open, used.deps), { status: 409, body: { error: "link_used" } });
  const expired = fakeDeps({ rpc: { phone_scan_open: { error: { message: "link_expired" } } } });
  assertEquals(await phoneScan(open, expired.deps), { status: 410, body: { error: "link_expired" } });
});

Deno.test("malformed requests and unexpected errors never leak details", async () => {
  const { deps } = fakeDeps({ rpc: { phone_scan_open: { error: { message: "relation x does not exist" } } } });
  assertEquals((await phoneScan({ ...open, token: "short" }, deps)).body, { error: "invalid_input" });
  assertEquals((await phoneScan(null, deps)).body, { error: "invalid_input" });
  assertEquals(await phoneScan(open, deps), { status: 500, body: { error: "unknown" } });
  // Phones send processed JPEG / WebP pages only.
  assertEquals((await phoneScan({ ...put, mime: "application/pdf" }, deps)).body, { error: "invalid_input" });
});

Deno.test("put: a signed upload link only after the database approves", async () => {
  const { deps, calls } = fakeDeps({
    rpc: { phone_scan_begin_page: { data: { file_id: FILE, object_key: "document/2026/10/p.jpg", status: "pending" } } },
  });
  const res = await phoneScan(put, deps);
  assertEquals((res.body.upload as { url: string }).url, "https://s3/document/2026/10/p.jpg?sig");
  assertEquals(calls, ["rpc phone_scan_begin_page", "presignPut document/2026/10/p.jpg image/jpeg"]);

  const refused = fakeDeps({ rpc: { phone_scan_begin_page: { error: { message: "too_many_pages" } } } });
  assertEquals(await phoneScan(put, refused.deps), { status: 409, body: { error: "too_many_pages" } });
  assertEquals(refused.calls, ["rpc phone_scan_begin_page"]);
});

Deno.test("confirm: right size and real type → a numbered page", async () => {
  const { deps, calls } = fakeDeps({
    rpc: { phone_scan_file: { data: pendingFile }, phone_scan_finish_upload: { data: { page_no: 3, page_count: 3 } } },
  });
  const res = await phoneScan({ ...confirm, width: 1200, height: 1600 }, deps);
  assertEquals(res.body, { file_id: FILE, page_no: 3, page_count: 3 });
  assertEquals(calls, ["rpc phone_scan_file", "rpc phone_scan_finish_upload ok=true"]);
});

Deno.test("confirm: an HTML file sent as a JPEG is deleted and never becomes a page", async () => {
  const html = new Uint8Array([..."<!doctype html><p>"].map((c) => c.charCodeAt(0)));
  const { deps, calls } = fakeDeps({ rpc: { phone_scan_file: { data: pendingFile } }, bytes: html });
  assertEquals((await phoneScan(confirm, deps)).body, { error: "file_type_not_allowed" });
  assertEquals(calls, ["rpc phone_scan_file", "remove document/2026/10/p.jpg", "rpc phone_scan_finish_upload ok=false"]);
});

Deno.test("confirm: missing or wrong-size object is refused", async () => {
  const missing = fakeDeps({ rpc: { phone_scan_file: { data: pendingFile } }, head: null });
  assertEquals((await phoneScan(confirm, missing.deps)).body, { error: "upload_incomplete" });
  const bigger = fakeDeps({ rpc: { phone_scan_file: { data: pendingFile } }, head: { size: 9_000_000, contentType: null } });
  assertEquals((await phoneScan(confirm, bigger.deps)).body, { error: "upload_incomplete" });
  assertEquals(bigger.calls, ["rpc phone_scan_file", "remove document/2026/10/p.jpg", "rpc phone_scan_finish_upload ok=false"]);
});

Deno.test("confirm: a retry after success does not touch storage again", async () => {
  const { deps, calls } = fakeDeps({
    rpc: {
      phone_scan_file: { data: { ...pendingFile, status: "uploaded" } },
      phone_scan_finish_upload: { data: { page_no: 1, page_count: 1 } },
    },
  });
  assertEquals((await phoneScan(confirm, deps)).body.page_no, 1);
  assertEquals(calls, ["rpc phone_scan_file", "rpc phone_scan_finish_upload ok=true"]);
});
