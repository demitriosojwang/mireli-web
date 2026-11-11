function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

/**
 * Shared Mi-Reli branded email HTML: one navy header with the round logo
 * tile, a paper body, and the same palette as the booking ticket so every
 * message reads as one product. Text fallbacks stay plain — HTML is an
 * upgrade above them, never instead of them.
 */
export const MIRELI_LOGO_URL = "https://mireli.online/mireli-logo.jpeg";

const palette = {
  navy: "#102b4e",
  ink: "#172b49",
  paper: "#f6f5f1",
  card: "#e6e1d8",
  teal: "#51c7ad",
  tealSoft: "#f3f7f6",
  tealLine: "#d8e9e5",
  slate: "#64748b",
} as const;

/** Navy header band with the logo tile (absolute URL — email clients cannot load relative paths). */
export function mireliEmailHeader(title: string): string {
  return (
    `<div style="height:6px;background:${palette.teal};border-radius:16px 16px 0 0"></div>` +
    `<div style="background:${palette.navy};padding:20px 24px 24px;color:#fff">` +
    `<table role="presentation" style="border-collapse:collapse"><tr>` +
    `<td style="padding-right:14px"><img src="${MIRELI_LOGO_URL}" width="48" height="48" alt="Mi-Reli logo"` +
    ` style="display:block;border-radius:12px;border:2px solid rgba(255,255,255,.35)"></td>` +
    `<td>` +
    `<p style="margin:4px 0 0;color:${palette.teal};font-size:11px;letter-spacing:2px;font-weight:bold">MI-RELI</p>` +
    `<h1 style="margin:2px 0 0;font-size:22px;line-height:1.25">${escapeHtml(title)}</h1>` +
    `</td></tr></table></div>`
  );
}

/** Full branded document: header band, paper body, footer note. */
export function mireliEmailShell(parts: {
  headerHtml: string;
  bodyHtml: string;
  footerNote: string;
}): string {
  return (
    `<!doctype html><html><body style="margin:0;background:${palette.paper};color:${palette.ink};font-family:Arial,Helvetica,sans-serif">` +
    `<div style="max-width:600px;margin:24px auto;padding:0 24px">` +
    parts.headerHtml +
    `<div style="background:#fff;border:1px solid ${palette.card};border-top:0;border-radius:0 0 16px 16px;padding:24px">` +
    parts.bodyHtml +
    `</div>` +
    `<p style="text-align:center;color:${palette.slate};font-size:12px;margin-top:16px">${parts.footerNote}</p>` +
    `</div></body></html>`
  );
}

/** Big bordered code block, same shape as the ticket's booking-reference box. */
export function mireliCodeBlock(heading: string, code: string): string {
  return (
    `<div style="background:${palette.tealSoft};border:1px solid ${palette.tealLine};border-radius:12px;padding:16px;margin:20px 0;text-align:center">` +
    `<p style="margin:0;color:${palette.slate};font-size:12px;text-transform:uppercase">${escapeHtml(heading)}</p>` +
    `<p style="margin:8px 0 0;font-size:30px;font-weight:bold;letter-spacing:8px;font-family:Consolas,Menlo,monospace">` +
    escapeHtml(code) +
    `</p></div>`
  );
}

export function mireliSupportLine(supportEmail: string): string {
  return `Contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:${palette.ink}">${escapeHtml(supportEmail)}</a> if you did not expect this message.`;
}
