import { describe, expect, it } from "vitest";
import {
  cancellationWhatsAppUrl,
  MIRELI_SUPPORT_PHONE_E164,
  MIRELI_SUPPORT_PHONE_LOCAL,
  MIRELI_SUPPORT_WHATSAPP_NUMBER,
} from "@/lib/support";

describe("passenger cancellation contact", () => {
  it("uses the approved local number in call, WhatsApp, and E.164 formats", () => {
    expect(MIRELI_SUPPORT_PHONE_LOCAL).toBe("0797118292");
    expect(MIRELI_SUPPORT_PHONE_E164).toBe("+254797118292");
    expect(MIRELI_SUPPORT_WHATSAPP_NUMBER).toBe("254797118292");

    const url = new URL(cancellationWhatsAppUrl("MR-ABC123"));
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/254797118292");
    expect(url.searchParams.get("text")).toContain("MR-ABC123");
  });
});
