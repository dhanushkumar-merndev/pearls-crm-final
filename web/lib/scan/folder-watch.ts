/**
 * Scanner-folder watch: the receptionist picks the folder the desk scanner saves into,
 * and every new file that appears there becomes a page. Uses the File System Access API
 * (Chrome and Edge on a computer). Firefox and Safari don't have it: there the scanner
 * shows "Upload files" instead. The chosen folder is remembered (IndexedDB) so the next
 * time one click — and the browser's own permission prompt — is enough.
 */
import { kvGet, kvSet } from "@/lib/upload-queue";

interface DirHandle {
  name: string;
  kind: "directory";
  entries(): AsyncIterableIterator<[string, { kind: "file" | "directory"; getFile?: () => Promise<File> }]>;
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
}
type Picker = (o?: { id?: string; mode?: "read" }) => Promise<DirHandle>;

export type FolderHandle = DirHandle;

export function folderWatchSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker === "function";
}

const KEY = "scanner-folder";

export async function pickFolder(): Promise<FolderHandle> {
  const handle = await (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ id: "pearl-scanner", mode: "read" });
  await kvSet(KEY, handle).catch(() => {}); // remembering is a convenience only
  return handle;
}

export async function rememberedFolder(): Promise<FolderHandle | null> {
  try {
    return (await kvGet<FolderHandle>(KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Asks again for permission on a remembered folder (must be called from a click). */
export async function regainAccess(handle: FolderHandle): Promise<boolean> {
  if (!handle.requestPermission) return true;
  if ((await handle.queryPermission?.({ mode: "read" })) === "granted") return true;
  return (await handle.requestPermission({ mode: "read" })) === "granted";
}

/**
 * Checks the folder every few seconds. Files already there when watching starts are
 * ignored; a new file is handed over once its size stops changing (the scanner has
 * finished writing it). Returns a stop function.
 */
export function watchFolder(dir: FolderHandle, onFile: (file: File) => void, onError: (e: unknown) => void, intervalMs = 2500): () => void {
  const seen = new Set<string>();
  const growing = new Map<string, number>();
  let first = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    try {
      for await (const [name, entry] of dir.entries()) {
        if (stopped) return;
        if (entry.kind !== "file" || seen.has(name) || name.startsWith(".") || name.startsWith("~")) continue;
        if (first) {
          seen.add(name);
          continue;
        }
        const file = await entry.getFile!();
        if (growing.get(name) === file.size && file.size > 0) {
          seen.add(name);
          growing.delete(name);
          onFile(file);
        } else {
          growing.set(name, file.size);
        }
      }
      first = false;
    } catch (e) {
      onError(e);
      return; // permission lost or folder gone: stop
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
