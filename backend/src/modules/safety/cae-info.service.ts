// The site's information handed to each contractor (docs/spec/cae.md, «Información»; RD 171/2004, arts.
// 7 to 9): which controlled documents are that information (settings.safety.cae.infoNodeIds, chosen by
// whoever manages CAE), each delivery with the version handed out, who received it and their signature,
// and its signed receipt as a PDF. Deliveries are evidence: never changed nor deleted.
import { escapeHtml } from "@spiderfolio/content";
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { dayIn, formatDateTimeIn, formatUtcDay, zoneOf } from "../../lib/time-zone.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { caeTexts, formMessages } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { signatureBytes } from "./ppe.service.ts";
import { currentInfoDocuments, infoKey, missingInfo, type InfoDocument } from "./cae-info-docs.ts";
import { dayOfDate } from "./cae-status.ts";
import type {
  CreateInfoDeliveryInput,
  InfoOptionsQuery,
  ListInfoDeliveriesQuery,
  UpdateInfoInput,
} from "./cae.schemas.ts";
import { accessOf, loadCompany, seesWhole } from "./cae.service.ts";
import { canManageCae, requireCae, safetySettingsOf } from "./safety-access.ts";

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireCae(ctx);
  if (!canManageCae(ctx)) throw forbidden();
}

export interface InfoSettingsView {
  /** The chosen documents still in force, in order. */
  documents: InfoDocument[];
  /** A contractor needs each of them, in its version in force, to be authorized. */
  required: boolean;
}

export async function getInfoSettings(ctx: AdminContext): Promise<InfoSettingsView> {
  await requireManager(ctx);
  const settings = await safetySettingsOf(ctx.db);
  return {
    documents: await currentInfoDocuments(ctx, settings.cae.infoNodeIds),
    required: settings.cae.infoRequired,
  };
}

export async function updateInfoSettings(
  ctx: AdminContext,
  input: UpdateInfoInput,
): Promise<InfoSettingsView> {
  await requireManager(ctx);
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
  const settings = await safetySettingsOf(ctx.db);
  const nodeIds =
    input.nodeIds === undefined ? settings.cae.infoNodeIds : [...new Set(input.nodeIds)];
  if (input.nodeIds !== undefined) {
    const found = await currentInfoDocuments(ctx, nodeIds);
    if (found.length !== nodeIds.length) {
      throw new AppError("BAD_REQUEST", { message: caeTexts.messages.infoNotDocument });
    }
  }
  const required = input.required ?? settings.cae.infoRequired;
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: {
      settings: {
        ...current,
        safety: {
          ...settings,
          cae: { ...settings.cae, infoNodeIds: nodeIds, infoRequired: required },
        },
      },
    },
  });
  await auditAdmin(ctx, {
    action: "cae.info.update",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: {
      before: { nodeIds: settings.cae.infoNodeIds, required: settings.cae.infoRequired },
      after: { nodeIds, required },
    },
  });
  return { documents: await currentInfoDocuments(ctx, nodeIds), required };
}

/** Controlled documents in force (code or title), to choose the information documents. */
export async function infoOptions(
  ctx: AdminContext,
  query: InfoOptionsQuery,
): Promise<Page<{ id: string; code: string; title: string }>> {
  await requireManager(ctx);
  const q = query.q ?? "";
  const where: Prisma.ControlledDocumentWhereInput = {
    publishedVersion: { not: null },
    node: { trashedAt: null },
    ...(query.ids === undefined ? {} : { nodeId: { in: query.ids } }),
    ...(q === ""
      ? {}
      : {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { node: { name: { contains: q, mode: "insensitive" } } },
          ],
        }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.controlledDocument.findMany({
      where,
      select: { nodeId: true, code: true, node: { select: { name: true } } },
      orderBy: [{ code: query.dir }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    ctx.db.controlledDocument.count({ where }),
  ]);
  return pageOf(
    rows.map((row) => ({ id: row.nodeId, code: row.code, title: row.node.name })),
    total,
    query,
  );
}

// ─── Deliveries ──────────────────────────────────────────────────────────────────────────

interface DeliveredItem {
  nodeId: string;
  version: number;
  code: string;
  title: string;
}

export interface InfoDeliveryView {
  id: string;
  deliveredOn: string;
  receivedBy: string;
  signed: boolean;
  items: DeliveredItem[];
  createdBy: { id: string; name: string };
  createdAt: Date;
}

const deliverySelect = {
  id: true,
  companyId: true,
  items: true,
  deliveredOn: true,
  receivedBy: true,
  signature: true,
  createdById: true,
  createdAt: true,
} as const;

type DeliveryRecord = Prisma.CaeInfoDeliveryGetPayload<{ select: typeof deliverySelect }>;

/** The items as they were saved (anything malformed is left out). */
function itemsOf(value: Prisma.JsonValue): DeliveredItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const { nodeId, version, code, title } = item as Record<string, unknown>;
    return typeof nodeId === "string" &&
      typeof version === "number" &&
      typeof code === "string" &&
      typeof title === "string"
      ? [{ nodeId, version, code, title }]
      : [];
  });
}

async function deliveryViews(
  ctx: AdminContext,
  rows: DeliveryRecord[],
): Promise<InfoDeliveryView[]> {
  const ids = [...new Set(rows.map((row) => row.createdById))];
  const members =
    ids.length === 0
      ? []
      : await ctx.db.membership.findMany({
          where: { id: { in: ids } },
          select: { id: true, user: { select: { name: true } } },
        });
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  return rows.map((row) => ({
    id: row.id,
    deliveredOn: dayOfDate(row.deliveredOn) ?? "",
    receivedBy: row.receivedBy,
    signed: row.signature !== null,
    items: itemsOf(row.items),
    createdBy: { id: row.createdById, name: nameOf.get(row.createdById) ?? "" },
    createdAt: row.createdAt,
  }));
}

/** A company the person sees whole (cae.manage or its responsible person); otherwise 404. */
async function wholeCompany(ctx: AdminContext, companyId: string) {
  const access = await accessOf(ctx);
  const company = await loadCompany(ctx, access, companyId);
  if (!seesWhole(access, company)) throw notFound();
  return company;
}

export interface CompanyInfoView {
  /** The information documents in force and whether the company has each in that version. */
  documents: (InfoDocument & { delivered: boolean })[];
  required: boolean;
}

/** Where the company stands with the site's information. */
export async function companyInfo(ctx: AdminContext, companyId: string): Promise<CompanyInfoView> {
  await requireCae(ctx);
  const company = await wholeCompany(ctx, companyId);
  const settings = await safetySettingsOf(ctx.db);
  const documents = await currentInfoDocuments(ctx, settings.cae.infoNodeIds);
  const missing = new Set(
    ((await missingInfo(ctx, [company.id], documents)).get(company.id) ?? []).map(infoKey),
  );
  return {
    documents: documents.map((doc) => ({ ...doc, delivered: !missing.has(infoKey(doc)) })),
    required: settings.cae.infoRequired,
  };
}

export async function listInfoDeliveries(
  ctx: AdminContext,
  companyId: string,
  query: ListInfoDeliveriesQuery,
): Promise<Page<InfoDeliveryView>> {
  await requireCae(ctx);
  await wholeCompany(ctx, companyId);
  const where = { companyId };
  const [rows, total] = await Promise.all([
    ctx.db.caeInfoDelivery.findMany({
      where,
      select: deliverySelect,
      orderBy: [{ deliveredOn: query.dir }, { createdAt: query.dir }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    ctx.db.caeInfoDelivery.count({ where }),
  ]);
  return pageOf(await deliveryViews(ctx, rows), total, query);
}

export async function createInfoDelivery(
  ctx: AdminContext,
  companyId: string,
  input: CreateInfoDeliveryInput,
): Promise<InfoDeliveryView> {
  await requireManager(ctx);
  const company = await wholeCompany(ctx, companyId);
  if (company.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.archived });
  }
  const available = await currentInfoDocuments(ctx);
  if (available.length === 0) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.infoNone });
  }
  const chosen =
    input.nodeIds === undefined
      ? available
      : [...new Set(input.nodeIds)].map((id) => {
          const doc = available.find((item) => item.nodeId === id);
          if (doc === undefined) {
            throw new AppError("BAD_REQUEST", { message: caeTexts.messages.infoNotChosen });
          }
          return doc;
        });
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const day = input.deliveredOn ?? dayIn(new Date(), zoneOf(workspace?.settings));
  const signature =
    input.signature === undefined || input.signature === null
      ? null
      : signatureBytes(input.signature);
  const items = chosen.map((doc) => ({
    nodeId: doc.nodeId,
    version: doc.version,
    code: doc.code,
    title: doc.title,
  }));
  const row = await ctx.db.caeInfoDelivery.create({
    data: {
      companyId,
      items,
      deliveredKeys: chosen.map(infoKey),
      deliveredOn: new Date(`${day}T00:00:00Z`),
      receivedBy: input.receivedBy,
      ...(signature === null ? {} : { signature: Uint8Array.from(signature) }),
      createdById: ctx.tenant.membershipId,
    },
    select: deliverySelect,
  });
  await auditAdmin(ctx, {
    action: "cae.info.deliver",
    entityType: "CaeInfoDelivery",
    entityId: row.id,
    metadata: {
      companyId,
      company: company.name,
      receivedBy: input.receivedBy,
      documents: items.map((item) => `${item.code} v${String(item.version)}`),
    },
  });
  const [view] = await deliveryViews(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

/** The signed receipt of a delivery. */
export async function infoDeliveryPdf(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  id: string,
): Promise<{ fileName: string; body: Uint8Array }> {
  await requireCae(ctx);
  if (deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: formMessages.pdfUnavailable });
  }
  const row = await ctx.db.caeInfoDelivery.findFirst({ where: { id }, select: deliverySelect });
  if (row === null) throw notFound();
  const company = await wholeCompany(ctx, row.companyId);
  const [view] = await deliveryViews(ctx, [row]);
  if (view === undefined) throw notFound();
  const workspace = await ctx.db.workspace.findFirst({
    where: {},
    select: { name: true, settings: true },
  });
  const zone = zoneOf(workspace?.settings);
  const locale = currentLocale();
  const t = caeTexts.info.pdf;
  const facts = [
    [t.company, company.name],
    [t.date, formatUtcDay(new Date(`${view.deliveredOn}T12:00:00Z`), locale)],
    [t.receivedBy, view.receivedBy],
    [t.deliveredBy, view.createdBy.name],
  ]
    .map(
      ([label = "", value = ""]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const rows = view.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.title)}</td><td>${String(item.version)}</td></tr>`,
    )
    .join("");
  const signature =
    row.signature === null
      ? `<p>${escapeHtml(t.noSignature)}</p>`
      : `<img alt="" src="data:image/png;base64,${Buffer.from(row.signature).toString("base64")}">`;
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; }
    h1 { font-size: 16pt; margin: 0 0 .2em; } .muted { color: #555; margin: 0 0 1.2em; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
    th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; }
    th { background: #f3f3f3; font-weight: normal; } table.facts th { width: 30%; }
    .sign img { height: 90px; border-bottom: 1px solid #888; }
  `;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body>
<h1>${escapeHtml(t.title)}</h1><p class="muted">${escapeHtml(workspace?.name ?? "")}</p>
<table class="facts">${facts}</table>
<table><thead><tr><th>${escapeHtml(t.columns.code)}</th><th>${escapeHtml(t.columns.title)}</th><th>${escapeHtml(
    t.columns.version,
  )}</th></tr></thead><tbody>${rows}</tbody></table>
<p>${escapeHtml(t.statement)}</p>
<div class="sign"><p>${escapeHtml(t.signature)}</p>${signature}<p>${escapeHtml(view.receivedBy)}</p></div>
<p class="muted">${escapeHtml(formatDateTimeIn(view.createdAt, zone, locale))}</p>
</body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const body = await renderWithGotenberg(deps.gotenbergUrl, {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(company.name)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${t.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  await auditAdmin(ctx, {
    action: "cae.info.export",
    entityType: "CaeInfoDelivery",
    entityId: row.id,
    metadata: { companyId: company.id },
  });
  return { fileName: t.fileName(company.name, view.deliveredOn), body };
}
