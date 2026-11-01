export const MIRELI_SUPPORT_PHONE_LOCAL = "0797118292";
export const MIRELI_SUPPORT_PHONE_E164 = "+254797118292";
export const MIRELI_SUPPORT_WHATSAPP_NUMBER = "254797118292";

export function cancellationWhatsAppUrl(bookingCode: string): string {
  const message = `Hello Mireli, I would like to request cancellation of booking ${bookingCode}.`;
  return `https://wa.me/${MIRELI_SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
