import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  positionFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { driverPosition: { findMany: mocks.positionFindMany } },
}));

import { GET } from "@/app/api/live-cabs/route";

afterEach(() => {
  vi.clearAllMocks();
});

describe("public live cabs", () => {
  it("returns recent cab fixes with no driver identity attached", async () => {
    const recordedAt = new Date("2026-11-16T12:00:00.000Z");
    mocks.positionFindMany.mockResolvedValue([
      { tripId: "trip-1", driverId: "driver-secret", lat: -4.05, lng: 39.66, bearingDeg: 90, recordedAt },
      { tripId: "trip-2", driverId: "driver-other", lat: -3.96, lng: 39.74, bearingDeg: null, recordedAt },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      cabs: [
        { id: "trip-1", lat: -4.05, lng: 39.66, bearingDeg: 90, recordedAt: recordedAt.toISOString() },
        { id: "trip-2", lat: -3.96, lng: 39.74, bearingDeg: null, recordedAt: recordedAt.toISOString() },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("driver-secret");
  });

  it("answers 503 instead of leaking a database failure", async () => {
    mocks.positionFindMany.mockRejectedValue(new Error("postgres://user:secret@db:5432/mireli"));

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain("secret");
    expect(JSON.parse(body)).toEqual({ error: "Live cabs are temporarily unavailable." });
  });
});
