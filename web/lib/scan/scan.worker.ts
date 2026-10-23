// Web Worker: page detection and clean-up off the main thread, so the screen stays responsive.
import { detectDocument } from "./detect";
import type { Pixels } from "./pixels";
import { processPage, type PageSettings } from "./process";

type Job = { op: "detect"; pixels: Pixels } | { op: "process"; pixels: Pixels; settings: PageSettings; maxSide: number };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; job: Job }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    if (job.op === "detect") {
      ctx.postMessage({ id, result: detectDocument(job.pixels) });
    } else {
      const out = processPage(job.pixels, job.settings, job.maxSide);
      ctx.postMessage({ id, result: out }, [out.data.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
