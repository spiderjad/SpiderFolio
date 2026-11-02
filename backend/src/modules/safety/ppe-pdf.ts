// A PPE handout receipt as a PDF (docs/spec/seguridad-salud.md, «EPIs»): who received what, when and
// from whom, the statement they signed and their signature. Needs Gotenberg; audited.
import { escapeHtml } from "@spiderfolio/content";
import { AppError } from "../../lib/errors.ts";
import { formatDateTimeIn, formatUtcDay, zoneOf } from "../../lib/time-zone.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { formMessages, safetyTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { deliverySignature, getDelivery } from "./ppe.service.ts";
import { requireSafety } from "./safety-access.ts";

export async function deliveryPdf(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  id: string,
): Promise<{ fileName: string; body: Uint8Array }> {
  const settings = await requireSafety(ctx);
  if (deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: formMessages.pdfUnavailable });
  }
  const delivery = await getDelivery(ctx, id);
  const signature = Buffer.from(await deliverySignature(ctx, id)).toString("base64");
  const workspace = await ctx.db.workspace.findFirst({
    where: {},
    select: { name: true, settings: true },
  });
  const person = await ctx.db.membership.findFirst({
    where: { id: delivery.person.id },
    select: { positionId: true },
  });
  const position =
    person?.positionId == null
      ? null
      : await ctx.db.position.findFirst({
          where: { id: person.positionId },
          select: { name: true },
        });
  const zone = zoneOf(workspace?.settings);
  const locale = currentLocale();
  const t = safetyTexts.pdf;
  const ppe = safetyTexts.ppe[settings.terms];
  const when = (date: Date) => formatDateTimeIn(date, zone, locale);
  const day = (value: string) => formatUtcDay(new Date(`${value}T12:00:00Z`), locale);
  const rows = delivery.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.item.name)}</td><td>${String(line.quantity)}</td><td>${escapeHtml(
          line.size ?? "—",
        )}</td><td>${line.replaceOn === null ? "—" : escapeHtml(day(line.replaceOn))}</td></tr>`,
    )
    .join("");
  const facts = [
    [t.person, delivery.person.name],
    ...(position === null ? [] : [[t.position, position.name]]),
    [t.date, when(delivery.deliveredAt)],
    [t.deliveredBy, delivery.deliveredBy.name],
  ]
    .map(
      ([label = "", value = ""]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; }
    h1 { font-size: 17pt; margin: 0 0 .2em; } .company { color: #555; margin: 0 0 1.2em; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
    th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; }
    th { background: #f3f3f3; font-weight: normal; } table.facts th { width: 30%; }
    .statement { margin: 1em 0; } .sign img { height: 90px; border-bottom: 1px solid #888; }
    .void { color: #b45309; font-weight: bold; margin: 0 0 1em; }
  `;
  const voided =
    delivery.voided === null
      ? ""
      : `<p class="void">${escapeHtml(
          t.voided(when(delivery.voided.at), delivery.voided.by.name, delivery.voided.reason),
        )}</p>`;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body>
<h1>${escapeHtml(t.title(ppe))}</h1><p class="company">${escapeHtml(workspace?.name ?? "")}</p>${voided}
<table class="facts">${facts}</table>
<table><thead><tr><th>${escapeHtml(t.columns.item)}</th><th>${escapeHtml(t.columns.quantity)}</th><th>${escapeHtml(
    t.columns.size,
  )}</th><th>${escapeHtml(t.columns.replaceOn)}</th></tr></thead><tbody>${rows}</tbody></table>
${delivery.note === null ? "" : `<p><strong>${escapeHtml(t.note)}:</strong> ${escapeHtml(delivery.note)}</p>`}
<p class="statement">${escapeHtml(t.statement)}</p>
<div class="sign"><p>${escapeHtml(t.signature)}</p><img alt="" src="data:image/png;base64,${signature}"><p>${escapeHtml(
    delivery.person.name,
  )}</p></div></body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const body = await renderWithGotenberg(deps.gotenbergUrl, {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(t.title(ppe))}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${t.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  await auditAdmin(ctx, {
    action: "safety.delivery.export",
    entityType: "SafetyDelivery",
    entityId: id,
    metadata: { membershipId: delivery.person.id },
  });
  return {
    fileName: t.fileName(delivery.person.name, delivery.deliveredAt.toISOString().slice(0, 10)),
    body,
  };
}
