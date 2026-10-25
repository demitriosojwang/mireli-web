import { PrismaClient } from "@prisma/client";
import {
  assertPassengerPiiEncryptionReady,
  encryptPassengerIdNumber,
  isEncryptedPassengerIdNumber,
} from "../src/lib/passenger-pii";

const BATCH_SIZE = 200;
const prisma = new PrismaClient();

async function backfillPassengerIds(): Promise<number> {
  let cursor: string | undefined;
  let encrypted = 0;
  for (;;) {
    const rows = await prisma.passenger.findMany({
      where: { idNumber: { not: null } },
      select: { id: true, idNumber: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return encrypted;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      if (!row.idNumber || isEncryptedPassengerIdNumber(row.idNumber)) continue;
      const result = await prisma.passenger.updateMany({
        where: { id: row.id, idNumber: row.idNumber },
        data: { idNumber: encryptPassengerIdNumber(row.idNumber) },
      });
      encrypted += result.count;
    }
  }
}

async function backfillBookingIds(): Promise<number> {
  let cursor: string | undefined;
  let encrypted = 0;
  for (;;) {
    const rows = await prisma.booking.findMany({
      where: { passengerIdNumber: { not: null } },
      select: { id: true, passengerIdNumber: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return encrypted;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      if (!row.passengerIdNumber || isEncryptedPassengerIdNumber(row.passengerIdNumber)) continue;
      const result = await prisma.booking.updateMany({
        where: { id: row.id, passengerIdNumber: row.passengerIdNumber },
        data: { passengerIdNumber: encryptPassengerIdNumber(row.passengerIdNumber) },
      });
      encrypted += result.count;
    }
  }
}

async function main() {
  assertPassengerPiiEncryptionReady();
  const passengerRows = await backfillPassengerIds();
  const bookingRows = await backfillBookingIds();
  console.log(`Passenger identity encryption complete: ${passengerRows} passenger rows, ${bookingRows} booking rows encrypted.`);
}

main()
  .catch(() => {
    // Do not log database values or exception objects that might contain SQL.
    console.error("Passenger identity encryption failed. Check database and key configuration.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
