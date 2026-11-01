import { PrismaClient } from "@prisma/client";

/**
 * First-run operations settings for a containerised deployment.
 *
 * Every booking, payout and settlement reads the single operations-settings
 * row (`PlatformConfig.id = "main"`). On a brand new database that row does
 * not exist, and the only surface that would create it is Admin → Payments,
 * which itself needs an administrator sign-in that needs the same row. This
 * script closes that loop, exactly as the admin console would:
 *
 *   - runs only when MIRELI_BOOTSTRAP_PLATFORM_CONFIG=true (explicit opt-in);
 *   - creates the row with the documented schema defaults and nothing else;
 *   - never modifies, deletes or resets an existing operator configuration;
 *   - never seeds bookings, drivers, timetable or money records.
 */
const url = process.env.DATABASE_URL || "";
if (!/^postgres(ql)?:/.test(url)) {
  console.error("[mireli] operations-settings bootstrap requires a PostgreSQL DATABASE_URL.");
  process.exit(1);
}

const db = new PrismaClient({ log: [] });
try {
  const existing = await db.platformConfig.findUnique({ where: { id: "main" } });
  if (existing) {
    console.log("[mireli] operations settings already exist; nothing was changed.");
  } else {
    await db.platformConfig.create({ data: { id: "main" } });
    console.log("[mireli] operations settings created with the documented defaults.");
  }
} catch (error) {
  // Never print a provider error: it may carry a connection credential.
  console.error(`[mireli] operations-settings bootstrap stopped (${error?.code || "BOOTSTRAP_FAILED"}).`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
