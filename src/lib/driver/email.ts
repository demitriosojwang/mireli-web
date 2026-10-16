import {DriverError} from "./errors";

export function emailAddress(value:unknown):string {
  if(typeof value!=="string" || /[\r\n]/.test(value))throw new DriverError(400,"INVALID_EMAIL","Enter a valid email address.");
  const email=value.trim().toLowerCase();
  if(email.length>254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email))
    throw new DriverError(400,"INVALID_EMAIL","Enter a valid email address.");
  return email;
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

export async function sendEmailCode(email:string,code:string):Promise<void> {
  if(!/^[0-9]{6}$/.test(code))throw new DriverError(400,"INVALID_CODE","Invalid verification code.");
  try {
    await sendTransactionalEmail({
      to: email,
      senderName: "Mireli Driver",
      subject: "Your Mireli Driver verification code",
      textContent: `Your Mireli Driver verification code is ${code}.\n\nIt expires in 5 minutes. Do not share this code.\nIf you did not request it, you can ignore this email.`,
      tags: ["driver-verification"],
    });
  } catch {
    throw new DriverError(503,"EMAIL_UNAVAILABLE","The verification email could not be sent. Please try again later.");
  }
}
