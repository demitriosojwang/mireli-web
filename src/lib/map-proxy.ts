export const OPENFREEMAP_ORIGIN = "https://tiles.openfreemap.org";
export const MAP_PROXY_PATH = "/api/map-proxy";
export const MAP_STYLE_URL = `${MAP_PROXY_PATH}?path=styles/liberty`;

const ALLOWED_ROOTS = ["styles/", "planet", "fonts/", "sprites/", "natural_earth/"];
const MAX_PATH_LENGTH = 512;

export function isAllowedMapAssetPath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.includes("..")) return false;
  if (path.includes("\\") || path.includes("//")) return false;
  if (path.includes("?") || path.includes("#")) return false;
  if (path.startsWith("/")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (/[\u0000-\u001f]/.test(path)) return false;

  return ALLOWED_ROOTS.some((root) =>
    root.endsWith("/") ? path.startsWith(root) : path === root || path.startsWith(`${root}/`),
  );
}

export function rewriteMapAssetUrls(body: string, origin: string): string {
  return body.split(`${OPENFREEMAP_ORIGIN}/`).join(`${origin}${MAP_PROXY_PATH}?path=`);
}
