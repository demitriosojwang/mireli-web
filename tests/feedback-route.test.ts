import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getPassengerSession: vi.fn(),
  rateLimitUpsert: vi.fn(),
  feedbackCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    driverRateLimit: { upsert: mocks.rateLimitUpsert },
    feedback: { create: mocks.feedbackCreate },
  },
}));
vi.mock("@/lib/session", () => ({ getPassengerSession: mocks.getPassengerSession }));

import { POST } from "@/app/api/feedback/route";

const request = (body: unknown) =>
  new NextRequest("https://mireli.test/api/feedback", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPassengerSession.mockResolvedValue({ id: "guest-1", name: "Guest" });
  mocks.rateLimitUpsert.mockResolvedValue({ count: 1 });
  mocks.feedbackCreate.mockResolvedValue({ id: "fb-1", createdAt: new Date() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("feedback route", () => {
  it("stores a guest problem report without login", async () => {
    const response = await POST(request({ category: "problem", message: "The map shows stops in the ocean", page: "/" }));

    expect(response.status).toBe(201);
    expect(mocks.feedbackCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: "problem", sessionId: "guest-1", page: "/" }),
      }),
    );
  });

  it("rejects unknown categories", async () => {
    const response = await POST(request({ category: "spam", message: "hello there" }));
    expect(response.status).toBe(400);
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
  });

  it("rejects messages that are too short", async () => {
    const response = await POST(request({ category: "idea", message: "hi" }));
    expect(response.status).toBe(400);
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
  });

  it("rate-limits after five messages in the window", async () => {
    mocks.rateLimitUpsert.mockResolvedValue({ count: 6 });
    const response = await POST(request({ category: "idea", message: "Add live train delays please" }));
    expect(response.status).toBe(429);
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the database is unavailable", async () => {
    mocks.feedbackCreate.mockRejectedValue(new Error("db down"));
    const response = await POST(request({ category: "problem", message: "Payment page is stuck" }));
    expect(response.status).toBe(503);
  });

  it("requires a session", async () => {
    mocks.getPassengerSession.mockResolvedValue(null);
    const response = await POST(request({ category: "problem", message: "Payment page is stuck" }));
    expect(response.status).toBe(401);
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
  });

  it("ignores a booking reference that is not a string", async () => {
    const response = await POST(request({ category: "problem", message: "Payment page is stuck", bookingId: 42 }));
    expect(response.status).toBe(400);
  });
});
