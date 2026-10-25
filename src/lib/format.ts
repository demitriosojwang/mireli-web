export function ksh(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `KSh ${n.toLocaleString("en-KE")}`;
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return `${fmtDate(d)} · ${fmtTime(d)}`;
}

export function daysUntil(d: string | Date): number {
  return Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000));
}

export const LEDGER_LABELS: Record<string, string> = {
  held: "Held (pending)",
  driver_payable: "Driver-payable",
  commission_taken: "Settled · driver paid",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  converted_to_credit: "Converted to credit",
  partially_converted_to_credit: "75% credit · 25% forfeited",
  forfeited: "Forfeited (no-show)",
};

export const BOOKING_LABELS: Record<string, string> = {
  awaiting_payment: "Payment due",
  confirmed: "Confirmed",
  boarded: "Boarded",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

export const TIER_LABELS: Record<string, string> = {
  early: "Cancellation notice at least 24 hours before pickup",
  late: "Cancellation notice within 24 hours of pickup",
  no_show: "No-show",
  platform_cancelled: "Cancelled by platform",
};

export function dirLabel(direction: string): string {
  return direction === "FROM_TERMINUS" ? "Terminus → Stage" : "Stage → Terminus";
}

/** +254712345001 / 0712345001 → 0712 345 001 (Kenyan local style). */
export function fmtPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("254") ? `0${digits.slice(3)}` : digits.startsWith("0") ? digits : `0${digits}`;
  return local.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
}
