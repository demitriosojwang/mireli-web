import { db } from "@/lib/db";
import {
  EmailProviderError,
  emailAddress,
  sendTransactionalEmail,
  transactionalEmailConfigured,
} from "@/lib/driver/email";

const TICKET_READY_STATUSES = new Set(["confirmed", "boarded", "completed"]);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function ksh(amount: number): string {
  return `KSh ${new Intl.NumberFormat("en-KE").format(amount)}`;
}

function journeyDate(value: Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

function ticketContent(booking: {
  code: string;
  passengerName: string | null;
  direction: string;
  stageName: string | null;
  homePickup: boolean;
  seats: number;
  isCharter: boolean;
  fareAmount: number;
  creditApplied: number;
  cashDue: number;
  passengerEmail: string | null;
  route: { name: string };
  trip: {
    departureAt: Date;
    train: { name: string } | null;
    driver: { name: string; plate: string } | null;
  } | null;
  ledgerEntry: { mpesaReceipt: string | null } | null;
}) {
  const name = booking.passengerName?.trim() || "traveller";
  const departure = booking.trip ? journeyDate(booking.trip.departureAt) : "Check your booking details";
  const direction = booking.direction === "TO_TERMINUS" ? "to Mombasa Terminus" : "from Mombasa Terminus";
  const stopLabel = booking.direction === "FROM_TERMINUS" ? "Drop-off" : "Pickup";
  let stopName = booking.stageName || "Mombasa Terminus";
  if (booking.homePickup) {
    // Older bookings used "Home pickup" for both directions. Normalize that
    // stored prefix while formatting so retried tickets show the correct leg.
    const area = stopName
      .replace(/^Home (?:pickup|drop-off)\s*·\s*/i, "")
      .replace(/\s+area$/i, "");
    stopName = `Door-to-door near ${area}`;
  }
  const vehicle = booking.isCharter ? "Private charter" : `${booking.seats} seat${booking.seats === 1 ? "" : "s"}`;
  const train = booking.trip?.train?.name || "Madaraka Express connection";
  const driver = booking.trip?.driver
    ? `${booking.trip.driver.name} · ${booking.trip.driver.plate}`
    : "Driver details will be shared before departure";
  const supportEmail = process.env.MIRELI_SUPPORT_EMAIL?.trim() || "mirelisgr001@gmail.com";
  const paid = ksh(booking.fareAmount);
  const receipt = booking.ledgerEntry?.mpesaReceipt;
  const subject = `Your Mi-Reli SGR ticket · ${booking.code}`;

  const textContent = [
    `Hello ${name},`,
    "",
    "Your Mi-Reli booking is confirmed. Keep this email for your journey.",
    "",
    `Booking reference: ${booking.code}`,
    `Journey: ${booking.route.name} ${direction}`,
    `Train: ${train}`,
    `Departure: ${departure} (East Africa Time)`,
    `${stopLabel}: ${stopName}`,
    `Ride: ${vehicle}`,
    `Driver: ${driver}`,
    `Total: ${paid}`,
    ...(booking.creditApplied > 0 ? [`Travel credit applied: ${ksh(booking.creditApplied)}`] : []),
    ...(receipt ? [`M-Pesa receipt: ${receipt}`] : []),
    "",
    `Show your booking reference to your driver when boarding. Contact ${supportEmail} if any journey detail looks wrong.`,
    "",
    "Mi-Reli · SGR connections made simpler",
  ].join("\n");

  const htmlContent = `<!doctype html><html><body style="margin:0;background:#f6f5f1;color:#172b49;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:24px auto;padding:24px">
    <div style="background:#102b4e;border-radius:16px 16px 0 0;padding:24px;color:#fff">
      <p style="margin:0;color:#51c7ad;font-size:12px;letter-spacing:2px;font-weight:bold">MI-RELI SGR</p>
      <h1 style="margin:10px 0 0;font-size:24px">Your journey is confirmed</h1>
    </div>
    <div style="background:#fff;border:1px solid #e6e1d8;border-top:0;border-radius:0 0 16px 16px;padding:24px">
      <p>Hello ${escapeHtml(name)},</p>
      <p>Keep this ticket handy and show the booking reference to your driver when boarding.</p>
      <div style="background:#f3f7f6;border:1px solid #d8e9e5;border-radius:12px;padding:16px;margin:20px 0">
        <p style="margin:0;color:#56677c;font-size:12px;text-transform:uppercase">Booking reference</p>
        <p style="margin:6px 0 0;font-size:24px;font-weight:bold;letter-spacing:2px">${escapeHtml(booking.code)}</p>
      </div>
      <table role="presentation" style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b">Journey</td><td style="padding:8px 0;text-align:right">${escapeHtml(booking.route.name)} ${escapeHtml(direction)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Train</td><td style="padding:8px 0;text-align:right">${escapeHtml(train)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Departure</td><td style="padding:8px 0;text-align:right">${escapeHtml(departure)} EAT</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">${stopLabel}</td><td style="padding:8px 0;text-align:right">${escapeHtml(stopName)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Ride</td><td style="padding:8px 0;text-align:right">${escapeHtml(vehicle)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Driver</td><td style="padding:8px 0;text-align:right">${escapeHtml(driver)}</td></tr>
        <tr><td style="padding:12px 0 0;border-top:1px solid #e6e1d8;font-weight:bold">Total</td><td style="padding:12px 0 0;border-top:1px solid #e6e1d8;text-align:right;font-weight:bold">${escapeHtml(paid)}</td></tr>
        ${booking.creditApplied > 0 ? `<tr><td style="padding:8px 0;color:#64748b">Travel credit applied</td><td style="padding:8px 0;text-align:right">${escapeHtml(ksh(booking.creditApplied))}</td></tr>` : ""}
        ${receipt ? `<tr><td style="padding:8px 0;color:#64748b">M-Pesa receipt</td><td style="padding:8px 0;text-align:right">${escapeHtml(receipt)}</td></tr>` : ""}
      </table>
      <p style="margin:24px 0 0;color:#64748b;font-size:13px">Contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a> if any journey detail looks wrong.</p>
    </div>
    <p style="text-align:center;color:#64748b;font-size:12px">Mi-Reli · SGR connections made simpler</p>
  </div></body></html>`;

  return { to: booking.passengerEmail, subject, textContent, htmlContent };
}

/**
 * Send a confirmed booking ticket once. A durable delivery row makes payment
 * webhook retries idempotent; uncertain provider outcomes require a human to
 * check the Brevo log before sending again.
 */
export async function sendBookingTicketEmail(bookingId: string): Promise<{
  status: string;
  lastErrorCode?: string | null;
}> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      route: true,
      trip: { include: { train: true, driver: true } },
      ledgerEntry: true,
    },
  });
  if (!booking || !TICKET_READY_STATUSES.has(booking.status) || !booking.ledgerEntry) {
    return { status: "not_ready" };
  }

  const delivery = await db.bookingTicketEmailDelivery.upsert({
    where: { bookingId },
    create: { bookingId },
    update: {},
  });
  if (["sent", "sending", "uncertain"].includes(delivery.status)) {
    return { status: delivery.status, lastErrorCode: delivery.lastErrorCode ?? null };
  }

  if (!transactionalEmailConfigured()) {
    await db.bookingTicketEmailDelivery.update({
      where: { bookingId },
      data: { status: "blocked", lastErrorCode: "PROVIDER_NOT_CONFIGURED" },
    });
    return { status: "blocked", lastErrorCode: "PROVIDER_NOT_CONFIGURED" };
  }

  const claimed = await db.bookingTicketEmailDelivery.updateMany({
    where: { bookingId, status: { in: ["pending", "failed", "blocked"] } },
    data: { status: "sending", attempts: { increment: 1 }, lastAttemptAt: new Date(), lastErrorCode: null },
  });
  if (claimed.count !== 1) {
    const current = await db.bookingTicketEmailDelivery.findUnique({ where: { bookingId } });
    return { status: current?.status || "pending", lastErrorCode: current?.lastErrorCode };
  }

  try {
    const content = ticketContent(booking);
    if (!content.to) throw new Error("RECIPIENT_MISSING");
    const messageId = await sendTransactionalEmail({
      to: emailAddress(content.to),
      subject: content.subject,
      textContent: content.textContent,
      htmlContent: content.htmlContent,
      tags: ["booking-ticket"],
      senderName: process.env.BREVO_SENDER_NAME?.trim() || "Mi-Reli SGR Bookings",
    });
    await db.bookingTicketEmailDelivery.update({
      where: { bookingId },
      data: { status: "sent", providerMessageId: messageId, sentAt: new Date(), lastErrorCode: null },
    });
    return { status: "sent" };
  } catch (error) {
    const uncertain = error instanceof EmailProviderError && error.outcome === "uncertain";
    const code = error instanceof EmailProviderError
      ? error.code
      : error instanceof Error && ["RECIPIENT_MISSING", "INVALID_EMAIL"].includes(error.message)
        ? error.message
        : "DELIVERY_FAILED";
    const status = uncertain ? "uncertain" : "failed";
    await db.bookingTicketEmailDelivery.update({
      where: { bookingId },
      data: { status, lastErrorCode: code },
    });
    return { status, lastErrorCode: code };
  }
}

/** Email is a side effect; never roll back a confirmed payment if it fails. */
export async function attemptBookingTicketEmail(bookingId: string): Promise<void> {
  try {
    const result = await sendBookingTicketEmail(bookingId);
    if (["blocked", "failed", "uncertain"].includes(result.status)) {
      console.warn("[booking-ticket-email] ticket delivery needs attention", {
        status: result.status,
        code: result.lastErrorCode || "UNKNOWN",
      });
    }
  } catch {
    console.warn("[booking-ticket-email] ticket delivery state could not be saved");
  }
}
