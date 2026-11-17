/**
 * One-off correction: replace obviously-wrong seeded stage coordinates with the
 * reviewed public map-feature candidates from
 * docs/STAGE-MAP-MATCHES-DRAFT.md ("Seeded coordinate discrepancy review" and
 * "Live production pin snapshot", 17 November 2026).
 *
 * Safety model:
 *  - Each target is keyed by its PRODUCTION stage ID (from the read-only
 *    /api/route-map snapshot) AND its expected current (bad) coordinate.
 *  - If a stage's live coordinate differs from the expected bad value, the
 *    script skips it and reports the mismatch instead of overwriting.
 *  - Stage IDs are preserved; only lat/lng change. Fares, order, names untouched.
 *  - Candidate coordinates are public map-feature references (World Bank ESIA
 *    GPS table, OpenStreetMap nodes, mapped POIs). Owner/driver confirmation of
 *    the exact roadside waiting point is still recommended before these are
 *    treated as final.
 *
 * Run: npx tsx scripts/fix-stage-pins.ts
 */
import { db } from "../src/lib/db";

interface PinFix {
  stageId: string;
  name: string;
  expectedLat: number;
  expectedLng: number;
  newLat: number;
  newLng: number;
  source: string;
}

// Coordinates from docs/stage-map-production-snapshot-2026-11-17.csv (expected)
// and docs/STAGE-MAP-MATCHES-DRAFT.md candidate table (new values).
const FIXES: PinFix[] = [
  {
    stageId: "cmwiyyu6f000llicy0i9txsow",
    name: "Fisheries",
    expectedLat: -4.05529, expectedLng: 39.68247, // sits in the harbour channel
    newLat: -3.99956, newLng: 39.70663,
    source: "Fisheries neighbourhood, mapcarta.com/N11468576704",
  },
  {
    stageId: "cmwiyyu66000dlicy0u96ejte",
    name: "Bamburi Mwisho",
    expectedLat: -3.9939, expectedLng: 39.7231,
    newLat: -4.00234, newLng: 39.69904,
    source: "Bamburi Mwisho bus stop, mapcarta.com/N7844424885",
  },
  {
    stageId: "cmwiyyu6h000nlicyiyursips",
    name: "Mwambeni",
    expectedLat: -4.02061, expectedLng: 39.72006, // duplicated with Nyali Centre
    newLat: -4.003597, newLng: 39.710908,
    source: "Mwembeni stage, World Bank Mombasa North Mainland ESIA GPS table",
  },
  {
    stageId: "cmwiyyu6o000vlicyug8qxtnx",
    name: "Bambolulu",
    expectedLat: -4.0221, expectedLng: 39.70214,
    newLat: -4.02515, newLng: 39.699461,
    source: "Bombolulu Stage, World Bank Mombasa North Mainland ESIA GPS table",
  },
  {
    stageId: "cmwiyyu6k000rlicysjs8aqlx",
    name: "Nyali Centre",
    expectedLat: -4.02061, expectedLng: 39.72006, // duplicated with Mwambeni
    newLat: -4.02201, newLng: 39.71968,
    source: "Nyali Centre mall pin, kenya.worldplaces.me",
  },
  {
    stageId: "cmwiyyu6m000tlicy1kmkc2xi",
    name: "VOK",
    expectedLat: -4.03809, expectedLng: 39.68118, // duplicated with Lights; near harbour water
    newLat: -4.03059, newLng: 39.6914,
    source: "VOK Stage nearby listing, review draft candidate table",
  },
  {
    stageId: "cmwiyyu6q000xlicynadzo43y",
    name: "Lights",
    expectedLat: -4.03809, expectedLng: 39.68118, // duplicated with VOK
    newLat: -4.0386, newLng: 39.68062,
    source: "Lights Stage OpenStreetMap node 3278126129",
  },
];

async function main() {
  let applied = 0;
  let skipped = 0;
  for (const fix of FIXES) {
    const stage = await db.routeStage.findUnique({
      where: { id: fix.stageId },
      select: { name: true, lat: true, lng: true, route: { select: { active: true, name: true } } },
    });
    if (!stage) {
      console.log(`SKIP ${fix.name}: stage ${fix.stageId} not found`);
      skipped += 1;
      continue;
    }
    const sameExpected =
      Math.abs(stage.lat - fix.expectedLat) < 1e-4 && Math.abs(stage.lng - fix.expectedLng) < 1e-4;
    if (!sameExpected) {
      console.log(
        `SKIP ${fix.name}: live coordinate (${stage.lat}, ${stage.lng}) does not match expected bad value (${fix.expectedLat}, ${fix.expectedLng}) — review manually`,
      );
      skipped += 1;
      continue;
    }
    await db.routeStage.update({
      where: { id: fix.stageId },
      data: { lat: fix.newLat, lng: fix.newLng },
    });
    console.log(
      `FIXED ${fix.name}: (${fix.expectedLat}, ${fix.expectedLng}) -> (${fix.newLat}, ${fix.newLng}) [${fix.source}]`,
    );
    applied += 1;
  }
  console.log(`\nDone: ${applied} corrected, ${skipped} skipped.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
