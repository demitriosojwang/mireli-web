import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const routeFindMany = vi.fn();
  const routeFindFirst = vi.fn();
  const routeFindUnique = vi.fn();
  const routeCreate = vi.fn();
  const routeUpdate = vi.fn();
  const stageFindFirst = vi.fn();
  const stageFindUnique = vi.fn();
  const stageCreate = vi.fn();
  const stageUpdate = vi.fn();
  const transaction = vi.fn(async (work: (tx: { routeStage: { update: typeof stageUpdate } }) => Promise<unknown>) =>
    work({ routeStage: { update: stageUpdate } }),
  );
  return {
    routeFindMany, routeFindFirst, routeFindUnique, routeCreate, routeUpdate,
    stageFindFirst, stageFindUnique, stageCreate, stageUpdate, transaction,
    getAdminSession: vi.fn(), audit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    route: {
      findMany: mocks.routeFindMany,
      findFirst: mocks.routeFindFirst,
      findUnique: mocks.routeFindUnique,
      create: mocks.routeCreate,
      update: mocks.routeUpdate,
    },
    routeStage: {
      findFirst: mocks.stageFindFirst,
      findUnique: mocks.stageFindUnique,
      create: mocks.stageCreate,
      update: mocks.stageUpdate,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/session", () => ({ getAdminSession: mocks.getAdminSession }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { GET, POST, PUT } from "@/app/api/admin/routes/route";

const admin = { id: "admin-1", name: "Mireli Admin", role: "admin", identifier: "admin@mireli.test" };
const post = (body: Record<string, unknown>) => new NextRequest("https://mireli.test/api/admin/routes", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});
const put = (body: Record<string, unknown>) => new NextRequest("https://mireli.test/api/admin/routes", {
  method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminSession.mockResolvedValue(admin);
  mocks.audit.mockResolvedValue(undefined);
  mocks.routeFindMany.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("admin route catalogue", () => {
  it("does not expose the catalogue to unauthenticated callers", async () => {
    mocks.getAdminSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.routeFindMany).not.toHaveBeenCalled();
  });

  it("does not allow unauthenticated route mutations", async () => {
    mocks.getAdminSession.mockResolvedValue(null);
    const response = await POST(post({ action: "create_route", name: "Coast route", durationMinutes: 75 }));
    expect(response.status).toBe(401);
    expect(mocks.routeCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-object JSON body with a controlled client error", async () => {
    const response = await POST(new NextRequest("https://mireli.test/api/admin/routes", {
      method: "POST", body: "null", headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A JSON object is required." });
  });

  it("creates an unpublished route without inventing stops", async () => {
    mocks.routeFindFirst.mockResolvedValue(null);
    mocks.routeCreate.mockResolvedValue({ id: "route-1", name: "Coast route", active: false, durationMinutes: 75 });
    const response = await POST(post({ action: "create_route", name: "Coast route", durationMinutes: 75 }));

    expect(response.status).toBe(201);
    expect(mocks.routeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: "Coast route", durationMinutes: 75, charterPrice: 0, active: false },
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "route.create", entityId: "route-1" }));
  });

  it("appends a validated stop only to a draft route", async () => {
    mocks.routeFindUnique.mockResolvedValue({ id: "route-1", active: false });
    mocks.stageFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ order: 2 });
    mocks.stageCreate.mockResolvedValue({ id: "stage-3", routeId: "route-1", name: "Bamburi", order: 3 });
    const response = await POST(post({
      action: "add_stage", routeId: "route-1", name: "Bamburi", lat: -4.00, lng: 39.70, fare: 400, homeSurcharge: 100,
    }));

    expect(response.status).toBe(201);
    expect(mocks.stageCreate).toHaveBeenCalledWith({
      data: { routeId: "route-1", name: "Bamburi", order: 3, lat: -4, lng: 39.7, fare: 400, homeSurcharge: 100 },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "route.stage.create" }));
  });

  it("rejects incomplete or invalid stop data before querying the database", async () => {
    const response = await POST(post({
      action: "add_stage", routeId: "route-1", name: "Bamburi", lat: 0, lng: 181, fare: 400, homeSurcharge: -1,
    }));

    expect(response.status).toBe(400);
    expect(mocks.routeFindUnique).not.toHaveBeenCalled();
    expect(mocks.stageCreate).not.toHaveBeenCalled();
  });

  it("keeps a route unpublished until it has complete, ordered, priced stops", async () => {
    mocks.routeFindUnique.mockResolvedValue({ id: "route-1", active: false, stages: [] });
    const response = await PUT(put({ action: "set_route_active", routeId: "route-1", active: true }));

    expect(response.status).toBe(409);
    expect(mocks.routeUpdate).not.toHaveBeenCalled();
  });

  it("publishes a route after every stage is valid and sequential", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1", active: false,
      stages: [
        { order: 1, lat: -4, lng: 39.7, fare: 400, homeSurcharge: 100 },
        { order: 2, lat: -3.9, lng: 39.8, fare: 500, homeSurcharge: 0 },
      ],
    });
    mocks.routeUpdate.mockResolvedValue({ id: "route-1", name: "Coast route", active: true });
    const response = await PUT(put({ action: "set_route_active", routeId: "route-1", active: true }));

    expect(response.status).toBe(200);
    expect(mocks.routeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { active: true } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "route.publish" }));
  });

  it("blocks live fare edits until the route is paused", async () => {
    mocks.stageFindUnique.mockResolvedValue({ id: "stage-1", routeId: "route-1", order: 1, route: { active: true } });
    const response = await PUT(put({
      action: "update_stage", stageId: "stage-1", name: "Bamburi", lat: -4, lng: 39.7, fare: 500, homeSurcharge: 0,
    }));

    expect(response.status).toBe(409);
    expect(mocks.stageUpdate).not.toHaveBeenCalled();
  });

  it("requires a complete route stop list when changing its order", async () => {
    mocks.routeFindUnique.mockResolvedValue({ id: "route-1", active: false, stages: [{ id: "stage-1", order: 1 }] });
    const response = await PUT(put({ action: "reorder_stages", routeId: "route-1", stageIds: ["stage-1", "foreign-stage"] }));

    expect(response.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reorders every stop in a draft route and audits the new order", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1", active: false,
      stages: [{ id: "stage-1", order: 1 }, { id: "stage-2", order: 2 }],
    });
    const response = await PUT(put({ action: "reorder_stages", routeId: "route-1", stageIds: ["stage-2", "stage-1"] }));

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.stageUpdate).toHaveBeenNthCalledWith(1, { where: { id: "stage-2" }, data: { order: 1 } });
    expect(mocks.stageUpdate).toHaveBeenNthCalledWith(2, { where: { id: "stage-1" }, data: { order: 2 } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "route.stages.reorder" }));
  });
});
