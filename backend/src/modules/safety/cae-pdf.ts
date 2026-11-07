// «Autorizados hoy» of one contractor as a PDF (docs/spec/cae.md, «Fases» 3): the company, the day, its
// own status and each active worker with whether they can come in and why not. Uses caeStatus like the
// API; IDs cut to their last 3 characters. Needs Gotenberg; audited.
import { escapeHtml } from "@spiderfolio/content";
import { AppError } from "../../lib/errors.ts";
import { dayIn, formatDateTimeIn, formatUtcDay, zoneOf } from "../../lib/time-zone.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { caeTexts, formMessages } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { companyStatusOf, workerStatuses } from "./cae-status.ts";
import { accessOf, loadCompany, maskedId } from "./cae.service.ts";
import { requireCae } from "./safety-access.ts";

/** Enough for any real contractor; the PDF says nothing is missing only up to here. */
const MAX_WORKERS = 2000;

export async function authorizedTodayPdf(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  companyId: string,
): Promise<{ fileName: string; body: Uint8Array }> {
  await requireCae(ctx);
  if (deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: formMessages.pdfUnavailable });
  }
  const access = await accessOf(ctx);
  const company = await loadCompany(ctx, access, companyId);
  const [workspace, me, workers] = await Promise.all([
    ctx.db.workspace.findFirst({ where: {}, select: { name: true, settings: true } }),
    ctx.db.membership.findFirst({
      where: { id: ctx.tenant.membershipId },
      select: { user: { select: { name: true } } },
    }),
    ctx.db.caeWorker.findMany({
      where: { companyId, archivedAt: null },
      select: {
        id: true,
        companyId: true,
        name: true,
        idNumber: true,
        task: true,
        blockedAt: true,
        blockedReason: true,
        archivedAt: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: MAX_WORKERS,
    }),
  ]);
  const [status, statuses] = await Promise.all([
    companyStatusOf(ctx, company),
    workerStatuses(ctx, workers),
  ]);
  const zone = zoneOf(workspace?.settings);
  const locale = currentLocale();
  const today = dayIn(new Date(), zone);
  const t = caeTexts.pdf;
  const rows = workers
    .map((worker) => {
      const result = statuses.get(worker.id);
      const ok = result?.authorized ?? false;
      return `<tr><td>${escapeHtml(worker.name)}</td><td>${escapeHtml(
        worker.idNumber === null ? "—" : maskedId(worker.idNumber),
      )}</td><td>${escapeHtml(worker.task ?? "—")}</td><td class="${ok ? "yes" : "no"}">${escapeHtml(
        ok ? t.yes : t.no,
      )}</td><td>${escapeHtml((result?.reasons ?? []).join(" · ") || "—")}</td></tr>`;
    })
    .join("");
  const facts = [
    [t.company, company.name],
    [t.date, formatUtcDay(new Date(`${today}T12:00:00Z`), locale)],
    [t.companyStatus, status.authorized ? t.authorized : t.notAuthorized],
  ]
    .map(
      ([label = "", value = ""]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const companyReasons =
    status.reasons.length === 0
      ? ""
      : `<ul class="reasons">${status.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`;
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.4; color: #1a1a1a; }
    h1 { font-size: 17pt; margin: 0 0 .2em; } .muted { color: #555; margin: 0 0 1em; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
    th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; }
    th { background: #f3f3f3; font-weight: normal; } table.facts th { width: 30%; }
    td.yes { color: #166534; font-weight: bold; } td.no { color: #b91c1c; font-weight: bold; }
    .reasons { margin: 0 0 1em; padding-left: 1.2em; color: #b91c1c; }
  `;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body>
<h1>${escapeHtml(t.title)}</h1><p class="muted">${escapeHtml(workspace?.name ?? "")}</p>
<table class="facts">${facts}</table>${companyReasons}
${
  workers.length === 0
    ? `<p>${escapeHtml(t.none)}</p>`
    : `<table><thead><tr><th>${escapeHtml(t.columns.worker)}</th><th>${escapeHtml(
        t.columns.idNumber,
      )}</th><th>${escapeHtml(t.columns.task)}</th><th>${escapeHtml(t.columns.status)}</th><th>${escapeHtml(
        t.columns.reasons,
      )}</th></tr></thead><tbody>${rows}</tbody></table>`
}
<p class="muted">${escapeHtml(t.generated(formatDateTimeIn(new Date(), zone, locale), me?.user.name ?? ""))}</p>
</body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const body = await renderWithGotenberg(deps.gotenbergUrl, {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(`${t.title} · ${company.name}`)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${t.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  await auditAdmin(ctx, {
    action: "cae.company.export",
    entityType: "CaeCompany",
    entityId: company.id,
    metadata: { name: company.name, day: today, workers: workers.length },
  });
  return { fileName: t.fileName(company.name, today), body };
}
