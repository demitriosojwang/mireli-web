import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { runOperationalTick } from "@/lib/engine";

/**
 * The ledger — READ-ONLY for the admin. Every shilling the platform holds is
 * in exactly one bucket. The admin inspects; the engine moves.
 */
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await runOperationalTick();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const entries = await db.ledgerEntry.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      booking: {
        include: { passenger: true, trip: { include: { driver: true, route: true } } },
      },
    },
  });

  const all = await db.ledgerEntry.findMany();
  const totals: Record<string, { count: number; total: number; cash: number }> = {};
  for (const e of all) {
    totals[e.status] = totals[e.status] || { count: 0, total: 0, cash: 0 };
    totals[e.status].count++;
    totals[e.status].total += e.totalAmount;
    totals[e.status].cash += e.cashAmount;
  }

  return NextResponse.json({
    totals,
    entries: entries.map((e) => ({
      id: e.id,
      bookingCode: e.booking.code,
      passenger: e.booking.passenger.name,
      phone: e.booking.passenger.phone,
      route: e.booking.trip?.route?.name || null,
      driver: e.booking.trip?.driver?.name || null,
      totalAmount: e.totalAmount,
      cashAmount: e.cashAmount,
      creditApplied: e.creditApplied,
      homeSurchargeAmount: e.homeSurchargeAmount,
      platformFeeAmount: e.platformFeeAmount,
      mpesaReceipt: e.mpesaReceipt,
      collectedAt: e.collectedAt,
      status: e.status,
      statusChangedAt: e.statusChangedAt,
    })),
  });
}
