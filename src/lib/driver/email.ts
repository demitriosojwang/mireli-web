import {DriverError} from "./errors";
import {escapeHtml as escapeText, mireliCodeBlock, mireliEmailHeader, mireliEmailShell, mireliSupportLine} from "@/lib/emails/brand";

export function emailAddress(value:unknown):string {
  if(typeof value!=="string" || /[\r\n]/.test(value))throw new DriverError(400,"INVALID_EMAIL","Enter a valid email address.");
  const email=value.trim().toLowerCase();
  if(email.length>254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email))
    throw new DriverError(400,"INVALID_EMAIL","Enter a valid email address.");
  return email;
}

export const MIRELI_SUPPORT_EMAIL_FALLBACK="mirelisgr001@gmail.com";

export function supportEmailAddress():string {
  const configured=process.env.MIRELI_SUPPORT_EMAIL?.trim();
  if(!configured)return MIRELI_SUPPORT_EMAIL_FALLBACK;
  try{return emailAddress(configured);}catch{return MIRELI_SUPPORT_EMAIL_FALLBACK;}
}

export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly outcome: "rejected" | "uncertain",
  ) {
    super(message);
    this.name = "EmailProviderError";
  }
}

export function transactionalEmailConfigured(): boolean {
  try {
    return !!process.env.BREVO_API_KEY?.trim() && !!emailAddress(process.env.BREVO_SENDER_EMAIL);
  } catch {
    return false;
  }
}

export function emailSignInConfigured():boolean {
  return (process.env.DRIVER_AUTH_SECRET?.length ?? 0) >= 32 && transactionalEmailConfigured();
}

export async function sendTransactionalEmail(message: {
  to: string;
  subject: string;
  textContent: string;
  htmlContent?: string;
  tags?: string[];
  senderName?: string;
}): Promise<string> {
  const to = emailAddress(message.to);
  const sender = emailAddress(process.env.BREVO_SENDER_EMAIL);
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) throw new EmailProviderError("Email provider is not configured.", "PROVIDER_NOT_CONFIGURED", "rejected");

  let response: Response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { email: sender, name: message.senderName || process.env.BREVO_SENDER_NAME?.trim() || "Mi-Reli" },
        to: [{ email: to }],
        subject: message.subject,
        textContent: message.textContent,
        ...(message.htmlContent ? { htmlContent: message.htmlContent } : {}),
        ...(message.tags?.length ? { tags: message.tags } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new EmailProviderError("Email provider response was not received.", "PROVIDER_RESPONSE_UNCERTAIN", "uncertain");
  }

  if (!response.ok) {
    const uncertain = response.status >= 500;
    console.error("brevo.send.rejected", {
      status: response.status,
      reason: uncertain ? "PROVIDER_RESPONSE_UNCERTAIN" : "PROVIDER_REJECTED",
    });
    throw new EmailProviderError(
      "Email provider did not accept the message.",
      uncertain ? "PROVIDER_RESPONSE_UNCERTAIN" : "PROVIDER_REJECTED",
      uncertain ? "uncertain" : "rejected",
    );
  }

  const result = await response.json().catch(() => ({})) as { messageId?: unknown };
  if (typeof result.messageId !== "string" || !result.messageId) {
    throw new EmailProviderError("Email provider did not return a message reference.", "PROVIDER_RESPONSE_UNCERTAIN", "uncertain");
  }
  return result.messageId;
}

export async function sendEmailCode(email:string,code:string,purpose:"driver"|"staff"="driver"):Promise<void> {
  if(!/^[0-9]{6}$/.test(code))throw new DriverError(400,"INVALID_CODE","Invalid verification code.");
  const supportEmail = supportEmailAddress();
  const staff = purpose === "staff";
  try {
    await sendTransactionalEmail({
      to: email,
      senderName: staff ? "Mireli Staff" : "Mireli Driver",
      subject: `Your Mireli ${staff ? "staff sign-in" : "Driver verification"} code`,
      textContent: `Your Mireli ${staff ? "staff sign-in" : "Driver verification"} code is ${code}.\n\nIt expires in 5 minutes. Do not share this code.\nIf you did not request it, you can ignore this email.`,
      htmlContent: mireliEmailShell({
        headerHtml: mireliEmailHeader(staff ? "Your staff sign-in code" : "Your driver sign-in code"),
        bodyHtml:
          `<p>Enter this 6-digit code in the ${staff ? "Mireli staff console" : "Mireli Driver app"} to finish signing in. It expires in 5 minutes and works only once.</p>` +
          mireliCodeBlock("Verification code", code) +
          `<p style="margin:0;color:#64748b;font-size:13px">${mireliSupportLine(supportEmail)}</p>`,
        footerNote: "Mireli Driver · part of the Mi-Reli network",
      }),
      tags: [`${purpose}-verification`],
    });
  } catch (error) {
    console.error("driver.email_code.failed", {
      reason: error instanceof EmailProviderError ? error.code : "UNEXPECTED",
    });
    throw new DriverError(503,"EMAIL_UNAVAILABLE","The verification email could not be sent. Please try again later.");
  }
}

export function driverSupportCaseReference(caseId:string):string {
  return `MDS-${caseId.replace(/[^a-zA-Z0-9]/g,"").slice(-10).toUpperCase()}`;
}

export async function sendDriverSupportAcknowledgementEmail(input:{email:string;driverId:string;caseId:string;driverName?:string|null}):Promise<void> {
  const reference=driverSupportCaseReference(input.caseId);
  const firstName=(input.driverName??"").trim().split(/\s+/)[0]||"Driver";
  const supportEmail=supportEmailAddress();
  try {
    await sendTransactionalEmail({
      to: input.email,
      senderName: "Mireli Driver",
      subject: `Mireli support request received — ${reference}`,
      textContent:
        `Hi ${firstName},\n\n`+
        `Mireli support has received your request.\n\n`+
        `Your support case reference is ${reference}. Our support team will review it and follow up by email.\n\n`+
        `If you need to reply, quote ${reference}.\n\n`+
        `— The Mireli Driver team\n${supportEmail}`,
      htmlContent: mireliEmailShell({
        headerHtml: mireliEmailHeader("We received your support request"),
        bodyHtml:
          `<p style="margin:0 0 12px;font-size:15px">Hi ${escapeText(firstName)},</p>`+
          `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">Mireli support has received your request. Our support team will review it and follow up by email.</p>`+
          mireliCodeBlock("Support case reference", reference)+
          `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">If you need to reply, please quote this reference.</p>`+
          `<p style="margin:16px 0 0;color:#64748b;font-size:13px">${mireliSupportLine(supportEmail)}</p>`,
        footerNote: "Mireli Driver · part of the Mi-Reli network",
      }),
      tags: ["driver-support-acknowledgement"],
    });
  } catch(error) {
    console.error("driver.support_ack_email.failed", {
      driverId: input.driverId,
      caseId: input.caseId,
      reason: error instanceof EmailProviderError ? error.code : "UNEXPECTED",
    });
  }
}

export async function sendDriverSupportReplyEmail(input:{email:string;driverId:string;caseId:string;reply:string;driverName?:string|null}):Promise<void> {
  const reference=driverSupportCaseReference(input.caseId);
  const firstName=(input.driverName??"").trim().split(/\s+/)[0]||"Driver";
  const supportEmail=supportEmailAddress();
  try {
    await sendTransactionalEmail({
      to: input.email,
      senderName: "Mireli Driver",
      subject: `Mireli support reply — ${reference}`,
      textContent:
        `Hi ${firstName},\n\n`+
        `Mireli support has replied to your request.\n\n`+
        `${input.reply}\n\n`+
        `Your support case reference is ${reference}.\n\n`+
        `— The Mireli Driver team\n${supportEmail}`,
      htmlContent: mireliEmailShell({
        headerHtml: mireliEmailHeader("A reply from Mireli support"),
        bodyHtml:
          `<p style="margin:0 0 12px;font-size:15px">Hi ${escapeText(firstName)},</p>`+
          `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">Mireli support has replied to your request.</p>`+
          `<div style="margin:0 0 16px;padding:16px;background:#f6f5f1;border:1px solid #e6e1d8;border-radius:12px;font-size:15px;line-height:1.55;white-space:pre-wrap">${escapeText(input.reply)}</div>`+
          mireliCodeBlock("Support case reference", reference)+
          `<p style="margin:16px 0 0;color:#64748b;font-size:13px">${mireliSupportLine(supportEmail)}</p>`,
        footerNote: "Mireli Driver · part of the Mi-Reli network",
      }),
      tags: ["driver-support-reply"],
    });
  } catch(error) {
    console.error("driver.support_reply_email.failed", {
      driverId: input.driverId,
      caseId: input.caseId,
      reason: error instanceof EmailProviderError ? error.code : "UNEXPECTED",
    });
  }
}

/**
 * Sent once, when compliance approves an application and the driver becomes active.
 * Approval has already committed by then, so a provider failure is logged and
 * swallowed: a missing welcome email must never roll back or block onboarding.
 */
export async function sendOnboardingWelcomeEmail(input:{email:string;driverName?:string|null}):Promise<void> {
  const supportEmail = supportEmailAddress();
  const firstName = (input.driverName ?? "").trim().split(/\s+/)[0] || "Driver";
  try {
    await sendTransactionalEmail({
      to: input.email,
      senderName: "Mireli Driver",
      subject: "You're approved — welcome to Mireli Driver",
      textContent:
        `Hi ${firstName},\n\n` +
        `Your Mireli driver account has been approved. You can now sign in to the Mireli Driver app and accept Mombasa SGR transfers.\n\n` +
        `We are genuinely glad to have you with us, and we hope to keep working together for a long time.\n\n` +
        `If anything about your account, documents or payouts needs attention, reply to this email or write to ${supportEmail}.\n\n` +
        `— The Mireli Driver team`,
      htmlContent: mireliEmailShell({
        headerHtml: mireliEmailHeader("You're approved — welcome aboard"),
        bodyHtml:
          `<p style="margin:0 0 12px;font-size:15px">Hi ${escapeText(firstName)},</p>` +
          `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">Your driver account is approved. You can sign in to the Mireli Driver app and start accepting <strong>Mombasa SGR transfers</strong>.</p>` +
          mireliCodeBlock("Account status", "APPROVED") +
          `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">We are genuinely glad to have you with us, and we hope to keep working together for a long time.</p>` +
          `<p style="margin:0 0 4px;font-size:15px;line-height:1.55">If anything about your account, documents or payouts needs attention, just reply to this email.</p>` +
          `<p style="margin:16px 0 0;color:#64748b;font-size:13px">${mireliSupportLine(supportEmail)}</p>`,
        footerNote: "Mireli Driver · part of the Mi-Reli network · Mombasa SGR transfers",
      }),
      tags: ["driver-onboarding"],
    });
  } catch (error) {
    console.error("driver.welcome_email.failed", {
      reason: error instanceof EmailProviderError ? error.code : "UNEXPECTED",
    });
  }
}
