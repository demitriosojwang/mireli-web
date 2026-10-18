export type CatalogueStatus = "loading" | "ready" | "empty" | "error";

export type BookingCatalogueView = "checking" | "closed" | "booking";

export function hasPublishedCustomerPoints(pointCount: number): boolean {
  return Number.isSafeInteger(pointCount) && pointCount > 0;
}

export function getBookingCatalogueView(
  status: CatalogueStatus,
  pointCount: number,
): BookingCatalogueView {
  if (status === "loading") return "checking";
  if (status === "empty" || (status === "ready" && !hasPublishedCustomerPoints(pointCount))) return "closed";
  return "booking";
}

export function shouldLoadTrainTimetable(status: CatalogueStatus, pointCount: number): boolean {
  return status === "error" || (status === "ready" && hasPublishedCustomerPoints(pointCount));
}
