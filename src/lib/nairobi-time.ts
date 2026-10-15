const DAY = 24 * 60 * 60 * 1000;
const OFFSET = 3 * 60 * 60 * 1000;

/** Kenya calendar dates are independent of the server/browser timezone. */
export function nairobiDate(date: Date): string {
  return new Date(date.getTime() + OFFSET).toISOString().slice(0, 10);
}

export function nairobiDayRange(value: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid travel date");
  const start = new Date(`${value}T00:00:00+03:00`);
  if (!Number.isFinite(start.getTime()) || nairobiDate(start) !== value) throw new Error("Invalid travel date");
  return { start, end: new Date(start.getTime() + DAY) };
}

export function nairobiEventAt(base: Date, dayOffset: number, hhmm: string): Date {
  if (!Number.isInteger(dayOffset) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new Error("Invalid train time");
  const { start } = nairobiDayRange(nairobiDate(base));
  const [hour, minute] = hhmm.split(":").map(Number);
  return new Date(start.getTime() + dayOffset * DAY + (hour * 60 + minute) * 60000);
}

/** Resolve an arrival from a service date plus the train's destination-day offset. */
export function nairobiTrainArrivalAt(
  base: Date,
  serviceDayOffset: number,
  destDayOffset: number,
  hhmm: string,
): Date {
  if (!Number.isInteger(destDayOffset) || destDayOffset < 0) throw new Error("Invalid train arrival day offset");
  return nairobiEventAt(base, serviceDayOffset + destDayOffset, hhmm);
}

