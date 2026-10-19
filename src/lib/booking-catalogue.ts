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

export function getCabAvailabilityCountLabel(params: {
  loading: boolean;
  status: CatalogueStatus;
  hasEligibleDrivers: boolean | null;
  cabCount: number;
  hasSelectedPoint: boolean;
}): string {
  if (params.loading) return "…";
  if (params.status === "error") return "Unavailable";
  if (params.hasEligibleDrivers === false) return "0 cabs";
  if (!params.hasSelectedPoint) return "Choose a stop";
  if (params.status === "loading") return "…";
  const count = Number.isSafeInteger(params.cabCount) && params.cabCount > 0
    ? params.cabCount
    : 0;
  return `${count} cabs`;
}
