import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findBooking: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findDelivery: vi.fn(),
  updateDelivery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.findBooking },
    bookingTicketEmailDelivery: {
      upsert: mocks.upsert,
      updateMany: mocks.updateMany,
      findUnique: mocks.findDelivery,
      update: mocks.updateDelivery,
    },
  },
}));

import { sendBookingTicketEmail } from "@/lib/booking-ticket-email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const booking = {
  id: "booking-1",
  code: "MR-123456",
  status: "confirmed",
  passengerName: "Amina <Passenger>",
  passengerEmail: "amina@example.com",
  passengerIdNumber: "DO-NOT-EMAIL",
  direction: "FROM_TERMINUS",
  stageName: "Nyali Centre",
  homePickup: false,
  seats: 2,
  isCharter: false,
  fareAmount: 850,
  creditApplied: 0,
  cashDue: 850,
  route: { name: "Mombasa Coast" },
  trip: {
    departureAt: new Date("2026-10-18T08:00:00.000Z"),
    train: { name: "Inter-County" },
    driver: { name: "Driver One", plate: "KDA 123A" },
  },
  ledgerEntry: { mpesaReceipt: "QWE1234567" },
};

describe("confirmed booking ticket email", () => {
  beforeEach(() => {
    vi.stubEnv("BREVO_API_KEY", "test-private-provider-key");
    vi.stubEnv("BREVO_SENDER_EMAIL", "bookings@example.com");
    mocks.findBooking.mockResolvedValue(booking);
    mocks.upsert.mockResolvedValue({ status: "pending", attempts: 0 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.updateDelivery.mockResolvedValue({ status: "sent" });
  });

  it("sends one branded ticket only after the confirmed booking has a ledger entry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "provider-message-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendBookingTicketEmail("booking-1")).resolves.toEqual({ status: "sent" });

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.sender).toEqual({ email: "bookings@example.com", name: "Mi-Reli SGR Bookings" });
    expect(payload.to).toEqual([{ email: "amina@example.com" }]);
    expect(payload.subject).toContain("MR-123456");
    expect(payload.textContent).toContain("Mombasa Coast");
    expect(payload.textContent).toContain("Nyali Centre");
    expect(payload.textContent).toContain("QWE1234567");
    expect(payload.htmlContent).toContain("&lt;Passenger&gt;");
    expect(payload.htmlContent).not.toContain("DO-NOT-EMAIL");
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId: "booking-1" },
      data: expect.objectContaining({ status: "sent", providerMessageId: "provider-message-1" }),
    }));
  });

  it("does not send a ticket while payment is unconfirmed or absent", async () => {
    mocks.findBooking.mockResolvedValueOnce({ ...booking, status: "awaiting_payment" });
    await expect(sendBookingTicketEmail("booking-1")).resolves.toEqual({ status: "not_ready" });
    expect(mocks.upsert).not.toHaveBeenCalled();

    mocks.findBooking.mockResolvedValueOnce({ ...booking, ledgerEntry: null });
    await expect(sendBookingTicketEmail("booking-1")).resolves.toEqual({ status: "not_ready" });
  });

  it("records missing provider configuration for later operational retry", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendBookingTicketEmail("booking-1")).resolves.toEqual({
      status: "blocked",
      lastErrorCode: "PROVIDER_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "blocked", lastErrorCode: "PROVIDER_NOT_CONFIGURED" },
    }));
  });

  it("does not send a second ticket after an accepted message", async () => {
    mocks.upsert.mockResolvedValueOnce({ status: "sent", attempts: 1 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendBookingTicketEmail("booking-1")).resolves.toEqual({ status: "sent", lastErrorCode: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("holds an ambiguous provider timeout for review instead of risking duplicate mail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network timeout")));

    await expect(sendBookingTicketEmail("booking-1")).resolves.toEqual({
      status: "uncertain",
      lastErrorCode: "PROVIDER_RESPONSE_UNCERTAIN",
    });
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "uncertain", lastErrorCode: "PROVIDER_RESPONSE_UNCERTAIN" },
    }));
  });
});
