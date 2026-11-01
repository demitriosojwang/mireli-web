import {
  decryptPassengerIdNumberWithKey,
  encryptPassengerIdNumberWithKey,
  isEncryptedPassengerIdNumber,
} from "../src/lib/passenger-pii-crypto.mjs";

const BATCH_SIZE = 200;

function configureDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  if (process.env.MIRELI_DATABASE_MODE === "external") {
    throw new Error("DATABASE_URL is required for an external database.");
  }
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
    throw new Error("Database connection settings are missing.");
  }
  const encode = encodeURIComponent;
  process.env.DATABASE_URL = `postgresql://${encode(POSTGRES_USER)}:${encode(POSTGRES_PASSWORD)}@127.0.0.1:5432/${encode(POSTGRES_DB)}?schema=public`;
}

function loadEncryptionKey() {
  const configured = process.env.PASSENGER_PII_ENCRYPTION_KEY?.trim() || "";
  if (!/^[\da-fA-F]{64}$/.test(configured)) {
    throw new Error("PASSENGER_PII_ENCRYPTION_KEY must contain 64 hexadecimal characters.");
  }
  return Buffer.from(configured, "hex");
}

async function main() {
  configureDatabaseUrl();
  const key = loadEncryptionKey();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const passengerRows = await backfill(prisma.passenger, "idNumber", key);
    const bookingRows = await backfill(prisma.booking, "passengerIdNumber", key);
    console.log(`Passenger identity encryption complete: ${passengerRows} passenger rows, ${bookingRows} booking rows encrypted.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function backfill(model, field, key) {
  let cursor;
  let encrypted = 0;
  for (;;) {
    const rows = await model.findMany({
      where: { [field]: { not: null } },
      select: { id: true, [field]: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return encrypted;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      const value = row[field];
      if (!value || isEncryptedPassengerIdNumber(value)) continue;
      // Validate that old encrypted values are not accidentally interpreted as
      // plaintext if a future envelope format changes.
      const encryptedValue = encryptPassengerIdNumberWithKey(value, key);
      if (decryptPassengerIdNumberWithKey(encryptedValue, key) !== value) {
        throw new Error("Passenger identity encryption verification failed.");
      }
      const result = await model.updateMany({
        where: { id: row.id, [field]: value },
        data: { [field]: encryptedValue },
      });
      encrypted += result.count;
    }
  }
}

main().catch(() => {
  // Never log database values, credentials, or exception metadata.
  console.error("Passenger identity encryption failed. Check database and key configuration.");
  process.exitCode = 1;
});
