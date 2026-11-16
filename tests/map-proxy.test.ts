import { describe, expect, it } from "vitest";
import {
  MAP_PROXY_PATH,
  MAP_STYLE_URL,
  OPENFREEMAP_ORIGIN,
  isAllowedMapAssetPath,
  resolvePublicOrigin,
  rewriteMapAssetUrls,
} from "@/lib/map-proxy";

describe("map asset path validation", () => {
  it("allows the OpenFreeMap resources the passenger style needs", () => {
    expect(isAllowedMapAssetPath("styles/liberty")).toBe(true);
    expect(isAllowedMapAssetPath("planet")).toBe(true);
    expect(isAllowedMapAssetPath("planet/12/2305/1837.pbf")).toBe(true);
    expect(isAllowedMapAssetPath("fonts/Noto Sans Regular/0-255.pbf")).toBe(true);
    expect(isAllowedMapAssetPath("sprites/ofm_f384/ofm.json")).toBe(true);
    expect(isAllowedMapAssetPath("sprites/ofm_f384/ofm.png")).toBe(true);
    expect(isAllowedMapAssetPath("natural_earth/ne2sr/3/4/5.png")).toBe(true);
  });

  it("rejects paths that could reach another host or walk out of the tile root", () => {
    expect(isAllowedMapAssetPath("")).toBe(false);
    expect(isAllowedMapAssetPath("styles/../../etc/passwd")).toBe(false);
    expect(isAllowedMapAssetPath("../planet/12/2305/1837.pbf")).toBe(false);
    expect(isAllowedMapAssetPath("https://tiles.openfreemap.org/styles/liberty")).toBe(false);
    expect(isAllowedMapAssetPath("//tiles.openfreemap.org/styles/liberty")).toBe(false);
    expect(isAllowedMapAssetPath("/styles/liberty")).toBe(false);
    expect(isAllowedMapAssetPath("styles/liberty?x=1")).toBe(false);
    expect(isAllowedMapAssetPath("styles\\liberty")).toBe(false);
    expect(isAllowedMapAssetPath("admin/users")).toBe(false);
    expect(isAllowedMapAssetPath("planet.json")).toBe(false);
    expect(isAllowedMapAssetPath("styles/liberty")).toBe(true);
  });

  it("rejects paths that are too long to be a tile request", () => {
    expect(isAllowedMapAssetPath(`styles/${"a".repeat(600)}`)).toBe(false);
  });
});

describe("map asset URL rewriting", () => {
  it("points upstream style assets at the same-origin proxy", () => {
    const style = JSON.stringify({
      glyphs: `${OPENFREEMAP_ORIGIN}/fonts/{fontstack}/{range}.pbf`,
      sprite: `${OPENFREEMAP_ORIGIN}/sprites/ofm_f384/ofm`,
      sources: {
        openmaptiles: { type: "vector", url: `${OPENFREEMAP_ORIGIN}/planet` },
        ne2_shaded: { type: "raster", tiles: [`${OPENFREEMAP_ORIGIN}/natural_earth/ne2sr/{z}/{x}/{y}.png`] },
      },
    });

    const rewritten = JSON.parse(rewriteMapAssetUrls(style, "https://mireli.online"));

    expect(rewritten.glyphs).toBe("https://mireli.online/api/map-proxy/fonts/{fontstack}/{range}.pbf");
    expect(rewritten.sprite).toBe("https://mireli.online/api/map-proxy/sprites/ofm_f384/ofm");
    expect(rewritten.sources.openmaptiles.url).toBe("https://mireli.online/api/map-proxy/planet");
    expect(rewritten.sources.ne2_shaded.tiles[0]).toBe(
      "https://mireli.online/api/map-proxy/natural_earth/ne2sr/{z}/{x}/{y}.png",
    );
  });

  it("keeps map template placeholders intact so the map can fill them in", () => {
    const rewritten = rewriteMapAssetUrls(
      `{"tiles":["${OPENFREEMAP_ORIGIN}/planet/{z}/{x}/{y}.pbf"]}`,
      "https://mireli.online",
    );
    expect(rewritten).toContain("/api/map-proxy/planet/{z}/{x}/{y}.pbf");
    expect(rewritten).not.toContain("%7Bz%7D");
  });

  it("leaves unrelated hosts alone", () => {
    const body = `{"image":"https://example.com/logo.png","x":"${OPENFREEMAP_ORIGIN}.evil.test/style.json"}`;
    expect(rewriteMapAssetUrls(body, "https://mireli.online")).toBe(body);
  });
});

describe("passenger map style url", () => {
  it("loads the basemap from the same-origin proxy", () => {
    expect(MAP_PROXY_PATH).toBe("/api/map-proxy");
    expect(MAP_STYLE_URL).toBe("/api/map-proxy/styles/liberty");
  });
});

describe("public origin resolution", () => {
  it("uses the configured public origin when one is set", () => {
    expect(resolvePublicOrigin("https://staging.mireli.online/api/map-proxy", "https://staging.mireli.online/")).toBe(
      "https://staging.mireli.online",
    );
  });

  it("keeps the request origin for a directly reached host", () => {
    expect(resolvePublicOrigin("http://localhost:3000/api/map-proxy", undefined)).toBe("http://localhost:3000");
  });

  it("falls back to the public site when the reverse proxy forwards the container address", () => {
    expect(resolvePublicOrigin("https://0.0.0.0:3000/api/map-proxy", undefined)).toBe("https://mireli.online");
  });
});
