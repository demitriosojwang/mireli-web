/** Fare values transcribed from the owner-supplied 12 Oct 2026 passenger fare sheet.
 *  Coordinates and door-to-door surcharges are deliberately not part of this
 *  catalogue because the sheet does not specify them. */
export const APPROVED_STAGE_FARES = [
  { coast: "north", name: "Kiembeni Mwisho", fare: 400 },
  { coast: "north", name: "Kiembeni Police", fare: 400 },
  { coast: "north", name: "Ananda Magaya", fare: 400, aliases: ["Ananda Marga"] },
  { coast: "north", name: "San Sera", fare: 400 },
  { coast: "north", name: "Green Estate", fare: 400 },
  { coast: "north", name: "Kona Kiembeni", fare: 400 },
  { coast: "north", name: "Bamburi Mwisho", fare: 400 },
  { coast: "north", name: "Bamburi Naivas", fare: 400, aliases: ["Naivas Bamburi"] },
  { coast: "north", name: "Total Bamburi", fare: 400 },
  { coast: "north", name: "Fisheries", fare: 400 },
  { coast: "north", name: "Mwenbeni", fare: 400, aliases: ["Mwembeni"] },
  { coast: "north", name: "GCC Junction", fare: 400, aliases: ["JCC Junction"] },
  { coast: "north", name: "Nyali Centre", fare: 400, aliases: ["Nyali Center"] },
  { coast: "north", name: "VOK", fare: 400 },
  { coast: "north", name: "Bambolulu", fare: 400, aliases: ["Bombolulu"] },
  { coast: "north", name: "Lights", fare: 400 },
  { coast: "north", name: "Mtwapa", fare: 400 },
  { coast: "north", name: "Malindi", fare: 700 },
  { coast: "north", name: "Changamwe", fare: 200 },
  { coast: "north", name: "Mikindani", fare: 250 },
  { coast: "north", name: "Miritini", fare: 250 },
  { coast: "north", name: "Town (CBD) / Mwembe Tayari", fare: 300, aliases: ["Town CBD", "Mwembe Tayari"] },
  { coast: "south", name: "Likoni Ferry Container", fare: 400 },
  { coast: "south", name: "Kona Mpya (Fayaz)", fare: 400, aliases: ["Fayaz (Kona Mpya)"] },
  { coast: "south", name: "Shika Adabu (Checkpoint)", fare: 400, aliases: ["ShikaAdabu Checkpoint"] },
  { coast: "south", name: "Diani Naivas", fare: 500 },
] as const;

function normalizeStageName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const fareByStageName = new Map<string, number>();
for (const stage of APPROVED_STAGE_FARES) {
  fareByStageName.set(normalizeStageName(stage.name), stage.fare);
  for (const alias of "aliases" in stage ? stage.aliases : []) {
    fareByStageName.set(normalizeStageName(alias), stage.fare);
  }
}

/** Returns the approved fare when the stop is on the supplied price sheet. */
export function getApprovedStageFare(name: string): number | null {
  return fareByStageName.get(normalizeStageName(name)) ?? null;
}
