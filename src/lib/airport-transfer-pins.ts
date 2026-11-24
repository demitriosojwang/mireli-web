export type TransferPin = { lat: number; lng: number };

export function isTransferPin(value: unknown): value is TransferPin {
  if (!value || typeof value !== "object" || !("lat" in value) || !("lng" in value)) return false;
  return typeof value.lat === "number" && value.lat >= -4.8 && value.lat <= -1.8 &&
    typeof value.lng === "number" && value.lng >= 38.7 && value.lng <= 41.5;
}

export function nearAirport(pin: TransferPin, airport: TransferPin): boolean {
  return Math.hypot(pin.lat - airport.lat, pin.lng - airport.lng) <= 0.022;
}
