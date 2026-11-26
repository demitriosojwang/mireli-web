import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/map-proxy/[...path]/route";

beforeEach(() => {
  vi.stubEnv("MIRELI_PUBLIC_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const request = (path: string[]) =>
  new Request(`https://mireli.online/api/map-proxy/${path.map(encodeURIComponent).join("/")}`);
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("map proxy route", () => {
  it("serves the upstream style with its assets rewritten to this origin", async () => {
    const upstreamStyle = JSON.stringify({
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
      sources: { openmaptiles: { url: "https://tiles.openfreemap.org/backup_planet" } },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => upstreamStyle,
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(["styles", "liberty"]), context(["styles", "liberty"]));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.glyphs).toBe("https://mireli.online/api/map-proxy/fonts/{fontstack}/{range}.pbf");
    expect(body.sprite).toBe("https://mireli.online/api/map-proxy/sprites/ofm_f384/ofm");
    expect(body.sources.openmaptiles.url).toBe("https://mireli.online/api/map-proxy/backup_planet");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("streams binary map tiles through unchanged", async () => {
    const tile = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/x-protobuf" }),
      body: tile,
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      request(["planet", "12", "2498", "2093.pbf"]),
      context(["planet", "12", "2498", "2093.pbf"]),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-protobuf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(tile);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://tiles.openfreemap.org/planet/12/2498/2093.pbf");
  });

  it("proxies the current OpenFreeMap backup planet TileJSON and vector tiles", async () => {
    const tileJson = JSON.stringify({ tiles: ["https://tiles.openfreemap.org/backup_planet/20261122_124456_pt/{z}/{x}/{y}.pbf"] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => tileJson,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/x-protobuf" }),
        body: new Uint8Array([1, 2, 3]),
      });
    vi.stubGlobal("fetch", fetchMock);

    const tileJsonResponse = await GET(request(["backup_planet"]), context(["backup_planet"]));
    expect(tileJsonResponse.status).toBe(200);
    expect(await tileJsonResponse.json()).toEqual({
      tiles: ["https://mireli.online/api/map-proxy/backup_planet/20261122_124456_pt/{z}/{x}/{y}.pbf"],
    });

    const tileResponse = await GET(
      request(["backup_planet", "20261122_124456_pt", "12", "2498", "2093.pbf"]),
      context(["backup_planet", "20261122_124456_pt", "12", "2498", "2093.pbf"]),
    );
    expect(tileResponse.status).toBe(200);
    expect(new Uint8Array(await tileResponse.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://tiles.openfreemap.org/backup_planet/20261122_124456_pt/12/2498/2093.pbf");
  });

  it("refuses paths outside the basemap tile root", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(["..", "etc", "passwd"]), context(["..", "etc", "passwd"]));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported map asset." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 without leaking the upstream failure when the tile host is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:443")));

    const response = await GET(
      request(["planet", "12", "2498", "2093.pbf"]),
      context(["planet", "12", "2498", "2093.pbf"]),
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain("ECONNREFUSED");
    expect(JSON.parse(body)).toEqual({ error: "The map is temporarily unavailable." });
  });
});
