// MapLibre 6 looks for its worker file next to its own script, which isn't there once Next.js
// bundles it ("Worker failed to load"). Copy the worker (and the shared code it imports) from the
// installed package into public/maplibre/ on every dev / build, so it always matches the version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const dist = dirname(createRequire(import.meta.url).resolve("maplibre-gl/dist/maplibre-gl.css"));
const out = join(import.meta.dirname, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(dist, file), join(out, file));
