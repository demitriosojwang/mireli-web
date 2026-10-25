import { Badge } from "@/components/ui/badge";
import { BOOKING_LABELS, LEDGER_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

const BOOKING_STYLES: Record<string, string> = {
  awaiting_payment: "bg-amber-100 text-amber-900 border-amber-200",
  confirmed: "bg-emerald-100 text-emerald-900 border-emerald-200",
  boarded: "bg-teal-100 text-teal-900 border-teal-200",
  cancelled: "bg-stone-100 text-stone-700 border-stone-200",
  completed: "bg-green-100 text-green-900 border-green-200",
  no_show: "bg-red-100 text-red-900 border-red-200",
};

const LEDGER_STYLES: Record<string, string> = {
  held: "bg-amber-100 text-amber-900 border-amber-200",
  driver_payable: "bg-teal-100 text-teal-900 border-teal-200",
  commission_taken: "bg-emerald-100 text-emerald-900 border-emerald-200",
  refunded: "bg-sky-100 text-sky-900 border-sky-200",
  partially_refunded: "bg-orange-100 text-orange-900 border-orange-200",
  converted_to_credit: "bg-violet-100 text-violet-900 border-violet-200",
  partially_converted_to_credit: "bg-violet-100 text-violet-900 border-violet-200",
  forfeited: "bg-red-100 text-red-900 border-red-200",
};

export function BookingStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", BOOKING_STYLES[status] || "")}>
      {BOOKING_LABELS[status] || status}
    </Badge>
  );
}

export function LedgerStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", LEDGER_STYLES[status] || "")}>
      {LEDGER_LABELS[status] || status}
    </Badge>
  );
}

const TRIP_STYLES: Record<string, string> = {
  scheduled: "bg-emerald-100 text-emerald-900 border-emerald-200",
  locked: "bg-amber-100 text-amber-900 border-amber-200",
  departed: "bg-teal-100 text-teal-900 border-teal-200",
  completed: "bg-green-100 text-green-900 border-green-200",
  cancelled: "bg-red-100 text-red-900 border-red-200",
};

export function TripStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    scheduled: "Scheduled",
    locked: "Locked",
    departed: "On the road",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return (
    <Badge variant="outline" className={cn("font-medium", TRIP_STYLES[status] || "")}>
      {labels[status] || status}
    </Badge>
  );
}

const REFUND_PAYOUT_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  queued: "bg-teal-100 text-teal-900 border-teal-200",
  completed: "bg-emerald-100 text-emerald-900 border-emerald-200",
  failed: "bg-red-100 text-red-900 border-red-200",
};

export function MoneyStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Pending",
    queued: "Queued",
    completed: "Completed",
    failed: "Failed",
  };
  return (
    <Badge variant="outline" className={cn("font-medium", REFUND_PAYOUT_STYLES[status] || "")}>
      {labels[status] || status}
    </Badge>
  );
}
