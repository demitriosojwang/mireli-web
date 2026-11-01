import { afterEach, describe, expect, it, vi } from "vitest";
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw } }));
import { GET } from "@/app/api/health/route";

afterEach(() => vi.clearAllMocks());

describe("container health probe", () => {
  it("answers 200 when PostgreSQL answers", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("answers 503 without leaking the connection failure detail", async () => {
    queryRaw.mockRejectedValue(new Error("postgres://user:secret@db:5432/mireli"));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("secret");
    expect(JSON.parse(body)).toEqual({ status: "unavailable" });
  });
});
