// A person's health and safety sheet as a PDF (docs/spec/seguridad-salud.md, «Ficha por persona»): their
// PPE and training for whoever sees the person (as the sheet); fitness for them and for safety.health;
// accidents and incidents only for safety.health. Needs Gotenberg; audited without content.
import { escapeHtml } from "@spiderfolio/content";
import { AppError } from "../../lib/errors.ts";
import { formatDateTimeIn, formatUtcDay, zoneOf } from "../../lib/time-zone.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { formMessages, safetyTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { fitnessOf } from "./fitness.service.ts";
import { incidentTypeLabel, listIncidents } from "./incidents.service.ts";
import { ListIncidentsQuerySchema } from "./incidents.schemas.ts";
import { personPpe } from "./ppe.service.ts";
import { assertSeesPerson, requireSafety } from "./safety-access.ts";
import { personTraining } from "./training.service.ts";

const day = (value: string, locale: string) => formatUtcDay(new Date(`${value}T12:00:00Z`), locale);

const table = (headers: string[], rows: string[][]) =>
  `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;

export async function personSheetPdf(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  membershipId: string,
): Promise<{ fileName: string; body: Uint8Array }> {
  await requireSafety(ctx);
  await assertSeesPerson(ctx, membershipId);
  if (deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: formMessages.pdfUnavailable });
  }
  const health = ctx.tenant.capabilities.includes("safety.health");
  const self = membershipId === ctx.tenant.membershipId;
  const [ppe, training, fitness, incidents] = await Promise.all([
    personPpe(ctx, membershipId),
    personTraining(ctx, membershipId),
    health || self ? fitnessOf(ctx, membershipId) : null,
    health
      ? listIncidents(ctx, ListIncidentsQuerySchema.parse({ person: membershipId, pageSize: 100 }))
      : null,
  ]);
  const [workspace, departments, me] = await Promise.all([
    ctx.db.workspace.findFirst({ where: {}, select: { name: true, settings: true } }),
    ctx.db.departmentMember.findMany({
      where: { membershipId },
      select: { department: { select: { name: true } } },
    }),
    ctx.db.membership.findFirst({
      where: { id: ctx.tenant.membershipId },
      select: { user: { select: { name: true } } },
    }),
  ]);
  const t = safetyTexts.personPdf;
  const locale = currentLocale();
  const zone = zoneOf(workspace?.settings);
  const now = new Date();
  const p = t.ppe;
  const ppeSection =
    ppe.current.length === 0
      ? `<p class="none">${escapeHtml(p.none)}</p>`
      : table(
          [p.item, p.quantity, p.size, p.delivered, p.replaceOn],
          ppe.current.map((row) => [
            row.item.name,
            String(row.quantity),
            row.size ?? "—",
            formatDateTimeIn(row.deliveredAt, zone, locale),
            row.replaceOn === null ? "—" : day(row.replaceOn, locale),
          ]),
        );
  const missing =
    ppe.missing.length === 0
      ? ""
      : `<p class="alert">${escapeHtml(p.missing)} ${ppe.missing
          .map((item) => escapeHtml(item.expired ? `${item.name} (${p.expired})` : item.name))
          .join(", ")}</p>`;
  const tr = t.training;
  const trainingSection =
    training.length === 0
      ? `<p class="none">${escapeHtml(tr.none)}</p>`
      : table(
          [tr.course, tr.state, tr.completed, tr.validUntil],
          training.map((row) => [
            `${row.document.code} ${row.document.name}`,
            t.states[row.state],
            row.completedAt === null ? "—" : formatUtcDay(row.completedAt, locale),
            row.validUntil === null ? "—" : day(row.validUntil, locale),
          ]),
        );
  const f = t.fitness;
  const fitnessSection =
    fitness === null
      ? ""
      : `<h2>${escapeHtml(f.title)}</h2>${
          fitness.items.length === 0
            ? `<p class="none">${escapeHtml(f.none)}</p>`
            : table(
                [f.status, f.validUntil, f.restrictions],
                fitness.items
                  .slice(0, 10)
                  .map((row) => [
                    f.statuses[row.status],
                    row.validUntil === null ? "—" : day(row.validUntil, locale),
                    row.restrictions ?? "—",
                  ]),
              )
        }`;
  const i = t.incidents;
  const statusLabel = safetyTexts.incidents.csv;
  const incidentsSection =
    incidents === null
      ? ""
      : `<h2>${escapeHtml(i.title)}</h2>${
          incidents.items.length === 0
            ? `<p class="none">${escapeHtml(i.none)}</p>`
            : table(
                [i.date, i.type, i.place, i.status],
                incidents.items.map((row) => [
                  day(row.occurredOn, locale),
                  incidentTypeLabel(row.type),
                  row.place ?? "—",
                  row.status === "OPEN"
                    ? statusLabel.open
                    : row.status === "INVESTIGATING"
                      ? statusLabel.investigating
                      : statusLabel.closed,
                ]),
              )
        }`;
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; }
    h1 { font-size: 16pt; margin: 0 0 .2em; } h2 { font-size: 12pt; margin: 1.4em 0 .4em; }
    .meta, .none { color: #555; margin: 0 0 .6em; } .alert { color: #9a3412; margin: .4em 0 0; }
    .health { border: 1px solid #d97706; background: #fffbeb; padding: 6px 8px; margin: .6em 0 0; }
    table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; }
    th { background: #f3f3f3; font-weight: normal; }
  `;
  const departmentNames = departments.map((row) => row.department.name).join(", ");
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body>
<h1>${escapeHtml(t.title)} · ${escapeHtml(ppe.person.name)}</h1>
<p class="meta">${escapeHtml(workspace?.name ?? "")} · ${escapeHtml(t.position)}: ${escapeHtml(
    ppe.person.position?.name ?? t.noPosition,
  )}${departmentNames === "" ? "" : ` · ${escapeHtml(t.departments)}: ${escapeHtml(departmentNames)}`}</p>
${fitness !== null || incidents !== null ? `<p class="health">${escapeHtml(t.health)}</p>` : ""}
<h2>${escapeHtml(p.title)}</h2>${ppeSection}${missing}
<h2>${escapeHtml(tr.title)}</h2>${trainingSection}
${fitnessSection}${incidentsSection}
<p class="meta" style="margin-top:1.4em">${escapeHtml(
    t.generated(formatDateTimeIn(now, zone, locale), me?.user.name ?? ""),
  )}</p></body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const body = await renderWithGotenberg(deps.gotenbergUrl, {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(t.title)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${safetyTexts.pdf.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  await auditAdmin(ctx, {
    action: "safety.person.export",
    entityType: "Membership",
    entityId: membershipId,
    // Which parts went in, never their content.
    metadata: { fitness: fitness !== null, incidents: incidents !== null },
  });
  return {
    fileName: t.fileName(ppe.person.name, now.toISOString().slice(0, 10)),
    body,
  };
}
