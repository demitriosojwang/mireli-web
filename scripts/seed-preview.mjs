import { PrismaClient } from "@prisma/client";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const local = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), ".local");
const expected = "file:./preview.db"; // the generated client targets .local/schema.prisma
if (process.env.DATABASE_URL !== expected || process.env.MIRELI_LOCAL_PREVIEW_DIR !== local ||
    process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.MIRELI_DEMO_MODE !== "true") {
  throw new Error("Seed refused: only this checkout's synthetic .local/preview.db is allowed.");
}
const db = new PrismaClient();
try {
  // Stable IDs and upserts preserve preview progress; no deletion or production imports.
  await db.platformConfig.upsert({ where: { id: "main" }, update: {}, create: {
    id: "main", adminEmails: JSON.stringify(["mirelisgr001@gmail.com"]), admin2faCode: "LOCAL-ONLY",
  } });
  for (const direction of ["MBA_TO_NBO", "NBO_TO_MBA"]) {
    const arrivalTimes = direction === "MBA_TO_NBO"
      ? ["14:10", "20:18", "03:55"]
      : ["14:00", "20:30", "03:55"];
    for (const [i, time] of ["08:00", "15:00", "22:00"].entries()) {
      const id = `preview-train-${direction}-${i}`;
      await db.train.upsert({ where: { id }, update: { destTime: arrivalTimes[i] }, create: {
        id, name: ["Inter-County", "Express", "Night Train"][i], direction,
        originCode: direction === "MBA_TO_NBO" ? "MTM" : "NTM",
        destCode: direction === "MBA_TO_NBO" ? "NTM" : "MTM",
        originTime: time, destTime: arrivalTimes[i], destDayOffset: i === 2 ? 1 : 0,
      } });
    }
  }
  for (const [i, name] of ["Nyali", "Diani"].entries()) {
    const id = `preview-route-${i}`;
    const routeName = `${i ? "South" : "North"} Coast — ${name} sample route`;
    await db.route.upsert({ where: { id }, update: { name: routeName }, create: {
      id, name: routeName, durationMinutes: i ? 100 : 60, charterPrice: i ? 7000 : 5000,
      stages: { create: [
        { id: `${id}-terminus`, name: "Mombasa Terminus", order: 0, lat: -4.009, lng: 39.601, fare: 0, homeSurcharge: 0 },
        { id: `${id}-stage`, name: `${name} sample meeting point`, order: 1, lat: i ? -4.28 : -4.02, lng: i ? 39.57 : 39.72, fare: i ? 500 : 400, homeSurcharge: 100 },
      ] },
    } });
    await db.driver.upsert({ where: { id: `preview-driver-${i}` }, update: {}, create: {
      id: `preview-driver-${i}`, name: `Sample Driver ${i + 1}`, phone: `+25470000000${i + 1}`,
      mpesaNumber: `+25470000000${i + 1}`, plate: `DEMO ${i + 1}`, cabType: "Sample shuttle", capacity: 10,
    } });
  }
  console.log("Synthetic preview network prepared; existing records preserved.");
} finally { await db.$disconnect(); }
