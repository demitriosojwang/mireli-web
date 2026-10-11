import {afterEach, describe, expect, it, vi} from "vitest";
const query = vi.hoisted(() => ({findMany: vi.fn(), configFindUnique: vi.fn()}));
vi.mock("@/lib/db", () => ({db: {route: query, platformConfig: {findUnique: query.configFindUnique}}}));
vi.mock("@/lib/engine", () => ({runOperationalTick: async () => {
  throw Object.assign(new Error("Operating settings are absent"), {status: 503, code: "PLATFORM_NOT_CONFIGURED"});
}}));
import {GET} from "@/app/api/routes/route";
afterEach(() => vi.resetAllMocks());

describe("public route catalogue on a fresh platform", () => {
  it("returns an empty catalogue without needing operating settings or creating records", async () => {
    query.findMany.mockResolvedValue([]);
    query.configFindUnique.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({bookingFeeAmount: 50, routes: []});
    expect(query.findMany.mock.calls[0][0].select.stages.select).toEqual({
      id: true, name: true, order: true, fare: true, homeSurcharge: true,
    });
  });
  it("preserves the configured route and stage prices", async () => {
    query.configFindUnique.mockResolvedValue({bookingFeeAmount: 75});
    query.findMany.mockResolvedValue([{id: "configured-route", name: "Configured transfer", durationMinutes: 35,
      charterPrice: 2400, stages: [{id: "configured-stage", name: "Meeting point", order: 1, fare: 450, homeSurcharge: 100}]}]);
    const response = await GET();
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      bookingFeeAmount: 75,
      routes: [{charterPrice: 2400, stages: [{fare: 450, homeSurcharge: 100}]}],
    });
    expect(result.routes[0].stages[0]).not.toHaveProperty("lat");
  });
  it("returns a controlled unavailable response without leaking a database credential", async () => {
    query.findMany.mockRejectedValue(new Error("postgres://private:secret@database"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
