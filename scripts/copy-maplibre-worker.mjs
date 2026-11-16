import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MapLibre GL parses vector tiles in a web worker. The bundler cannot emit
 * that worker itself, so the published worker is copied into `public/` and the
 * app points MapLibre at it with `setWorkerUrl`. Without this the map renders
 * an empty canvas and the browser logs "Worker failed to load".
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const target = join(root, "public", "maplibre-gl-worker.mjs");

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(source, target);
console.log("copied maplibre worker -> public/maplibre-gl-worker.mjs");
