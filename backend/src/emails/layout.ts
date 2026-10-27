// Plantilla común de los emails transaccionales (CLAUDE.md, sección 12A.1): HTML simple con
// estilos en línea (los clientes de correo no cargan CSS externo) y versión de texto plano.
// Todo lo que viene de datos se escapa: un nombre nunca puede inyectar HTML.
import { emailTexts } from "../i18n/index.ts";
import { currentLocale } from "../i18n/locales.ts";

const BRAND_COLOR = "#7c3aed";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface LayoutInput {
  subject: string;
  title: string;
  /** Párrafos en texto plano: se escapan acá. */
  paragraphs: readonly string[];
  /** Botón principal (enlace absoluto http/https). */
  action?: { label: string; url: string };
  /** Párrafos debajo del botón (ej. vencimiento del enlace). */
  footnotes?: readonly string[];
  /** Color del workspace (#rrggbb ya validado); por defecto, el de la marca. */
  accentColor?: string | null;
}

function safeUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Enlace de email con protocolo no permitido");
  }
  return parsed.toString();
}

const paragraph = (p: string) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p)}</p>`;

export function renderEmail(input: LayoutInput): EmailContent {
  const accent = input.accentColor ?? BRAND_COLOR;
  const action =
    input.action === undefined
      ? null
      : { label: input.action.label, url: safeUrl(input.action.url) };
  const button =
    action === null
      ? ""
      : `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 16px;line-height:1.6;font-size:13px;color:#6b6b74">${escapeHtml(emailTexts.linkFallback)}<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`;
  const footnotes = input.footnotes ?? [];

  const html = `<!doctype html>
<html lang="${currentLocale()}"><body style="margin:0;background:#f8f8f9;font-family:Arial,Helvetica,sans-serif;color:#131316">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e7ea;border-radius:16px">
<tr><td style="padding:24px 32px;border-bottom:3px solid ${accent};font-weight:bold;font-size:18px">SpiderFolio</td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 24px;font-size:22px">${escapeHtml(input.title)}</h1>
${input.paragraphs.map(paragraph).join("")}${button}${footnotes.map(paragraph).join("")}
</td></tr>
<tr><td style="padding:16px 32px;color:#6b6b74;font-size:12px;line-height:1.5">${escapeHtml(emailTexts.footer)}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    input.title,
    "",
    ...input.paragraphs,
    ...(action === null ? [] : ["", `${action.label}: ${action.url}`]),
    ...(footnotes.length === 0 ? [] : ["", ...footnotes]),
    "",
    "—",
    emailTexts.footer,
  ].join("\n");
  return { subject: input.subject, html, text };
}
