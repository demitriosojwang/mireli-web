import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  trainFindMany: vi.fn(),
  trainFindFirst: vi.fn(),
  trainFindUnique: vi.fn(),
  trainCreate: vi.fn(),
  trainUpdate: vi.fn(),
  tripCount: vi.fn(),
  getAdminSession: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    train: {
      findMany: mocks.trainFindMany,
      findFirst: mocks.trainFindFirst,
      findUnique: mocks.trainFindUnique,
      create: mocks.trainCreate,
      update: mocks.trainUpdate,
    },
    trip: { count: mocks.tripCount },
  },
}));
vi.mock("@/lib/session", () => ({ getAdminSession: mocks.getAdminSession }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { GET, POST, PUT } from "@/app/api/admin/timetable/route";

const admin = { id: "admin-1", name: "Mireli Admin", role: "admin", identifier: "admin@mireli.test" };
const request = (method: "POST" | "PUT", body: Record<string, unknown>) => new NextRequest("https://mireli.test/api/admin/timetable", {
  method, body: JSON.stringify(body), headers: { "content-type": "application/json" },
});
const validTrain = {
  name: "Inter-County", direction: "NBO_TO_MBA", originTime: "08:00", destTime: "14:00", destDayOffset: 0,
  serviceDays: [0, 1, 2, 3, 4, 5, 6],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminSession.mockResolvedValue(admin);
  mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("admin SGR timetable", () => {
  it("requires admin access to read the timetable", async () => {
    mocks.getAdminSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.trainFindMany).not.toHaveBeenCalled();
  });

  it("creates a draft timetable entry with terminus codes derived from direction", async () => {
    mocks.trainFindFirst.mockResolvedValue(null);
    mocks.trainCreate.mockResolvedValue({ id: "train-1", ...validTrain, originCode: "NTM", destCode: "MTM", active: false });
    const response = await POST(request("POST", { action: "create_train", ...validTrain }));

    expect(response.status).toBe(201);
    expect(mocks.trainCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { ...validTrain, originCode: "NTM", destCode: "MTM", active: false },
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "timetable.train.create" }));
  });

  it("rejects invalid times before writing a train", async () => {
    const response = await POST(request("POST", {
      action: "create_train", ...validTrain, originTime: "25:10",
    }));
    expect(response.status).toBe(400);
    expect(mocks.trainCreate).not.toHaveBeenCalled();
  });

  it("requires at least one unique origin service weekday", async () => {
    for (const serviceDays of [[], [1, 1], [7], ["1"]]) {
      const response = await POST(request("POST", { action: "create_train", ...validTrain, serviceDays }));
      expect(response.status).toBe(400);
    }
    expect(mocks.trainCreate).not.toHaveBeenCalled();
  });

  it("requires an explicit next-day offset when arrival is after midnight", async () => {
    const response = await POST(request("POST", {
      action: "create_train", ...validTrain, originTime: "22:00", destTime: "03:55", destDayOffset: 0,
    }));
    expect(response.status).toBe(400);
    expect(mocks.trainCreate).not.toHaveBeenCalled();
  });

  it("accepts a valid next-day arrival without publishing it", async () => {
    const nightTrain = { ...validTrain, name: "Night Train", originTime: "22:00", destTime: "03:55", destDayOffset: 1 };
    mocks.trainFindFirst.mockResolvedValue(null);
    mocks.trainCreate.mockResolvedValue({ id: "train-night", ...nightTrain, originCode: "NTM", destCode: "MTM", active: false });
    const response = await POST(request("POST", { action: "create_train", ...nightTrain }));
    expect(response.status).toBe(201);
    expect(mocks.trainCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ destDayOffset: 1, active: false }) }));
  });

  it("rejects edits to a train that already has trip history", async () => {
    mocks.trainFindUnique.mockResolvedValue({ id: "train-1", active: false });
    mocks.tripCount.mockResolvedValue(2);
    const response = await PUT(request("PUT", { action: "update_train", trainId: "train-1", ...validTrain }));

    expect(response.status).toBe(409);
    expect(mocks.trainUpdate).not.toHaveBeenCalled();
  });

  it("publishes and audits a confirmed train entry", async () => {
    mocks.trainFindUnique.mockResolvedValue({
      id: "train-1", active: false, ...validTrain, originCode: "NTM", destCode: "MTM",
    });
    mocks.trainUpdate.mockResolvedValue({ id: "train-1", name: "Inter-County", active: true });
    const response = await PUT(request("PUT", { action: "set_train_active", trainId: "train-1", active: true }));

    expect(response.status).toBe(200);
    expect(mocks.trainUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { active: true } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "timetable.train.publish" }));
  });
});
