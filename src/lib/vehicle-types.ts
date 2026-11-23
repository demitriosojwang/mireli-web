export const VEHICLE_CATEGORIES = ["motorbike", "tuk-tuk", "car", "van", "other"] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  motorbike: "Motorbike",
  "tuk-tuk": "Tuk-tuk",
  car: "Car",
  van: "Van",
  other: "Other",
};

export function vehicleCategoryFromCabType(cabType: string | null | undefined): VehicleCategory {
  const type = (cabType ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/motor ?bike|motorcycle|boda|bike/.test(type)) return "motorbike";
  if (/tuk ?tuk|tuktuk|rickshaw/.test(type)) return "tuk-tuk";
  if (/van|matatu|shuttle|bus|7 ?seater|14 ?seater/.test(type)) return "van";
  if (/car|sedan|saloon|suv|4 ?seater|probox|station wagon|estat/.test(type)) return "car";
  return "other";
}
