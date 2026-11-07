// Work permits (docs/spec/cae.md, «Permisos de trabajo»): hot work, work at height, confined spaces,
// electrical work or another kind, for contractors' workers and the company's own staff. Issued as a
// draft, approved with whoever approves' signature once every precaution is checked (then active within
// its dates, at most caeLimits.permitMaxDays), closed or cancelled. Never deleted.
//
// Issued, approved, closed and cancelled by `cae.manage`; read by `cae.check` too (the gatehouse sees
// the active permits of each worker). A contractor's worker who isn't authorized can't be on one.
import { escapeHtml } from "@spiderfolio/content";
import { caeLimits } from "@spiderfolio/limits";
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { endOfDayIn, formatDateTimeIn, startOfDayIn, zoneOf } from "../../lib/time-zone.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { caeTexts, formMessages } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { signatureBytes } from "./ppe.service.ts";
import { workerStatuses } from "./cae-status.ts";
import type {
  ApprovePermitInput,
  CreatePermitInput,
  ListPermitsQuery,
  UpdatePermitInput,
} from "./cae.schemas.ts";
import { canCheckCae, canManageCae, requireCae } from "./safety-access.ts";

type PermitType = "HOT_WORK" | "HEIGHT" | "CONFINED_SPACE" | "ELECTRICAL" | "OTHER";
type PermitStatus = "DRAFT" | "ACTIVE" | "CLOSED" | "CANCELLED";

/** What a list shows: the stored status plus, for an active one, whether it started or ended. */
export type PermitState = "draft" | "scheduled" | "active" | "expired" | "closed" | "cancelled";

interface Precaution {
  label: string;
  done: boolean;
}

export interface PermitView {
  id: string;
  type: PermitType;
  customName: string | null;
  company: { id: string; name: string } | null;
  location: string;
  description: string;
  validFrom: Date;
  validTo: Date;
  workers: { id: string; name: string; company: string }[];
  members: { id: string; name: string }[];
  precautions: Precaution[];
  status: PermitStatus;
  state: PermitState;
  issuedBy: { id: string; name: string };
  approved: { at: Date; by: { id: string; name: string } } | null;
  closed: { at: Date; by: { id: string; name: string }; note: string | null } | null;
  canManage: boolean;
}

const permitSelect = {
  id: true,
  type: true,
  customName: true,
  companyId: true,
  location: true,
  description: true,
  validFrom: true,
  validTo: true,
  workerIds: true,
  membershipIds: true,
  precautions: true,
  status: true,
  issuedById: true,
  approvedById: true,
  approvedAt: true,
  closedAt: true,
  closedById: true,
  closeNote: true,
  company: { select: { id: true, name: true } },
} as const;

type PermitRecord = Prisma.CaeWorkPermitGetPayload<{ select: typeof permitSelect }>;

async function requireReader(ctx: AdminContext): Promise<void> {
  await requireCae(ctx);
  if (!canCheckCae(ctx)) throw forbidden();
}

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireCae(ctx);
  if (!canManageCae(ctx)) throw forbidden();
}

export function permitState(
  row: { status: PermitStatus; validFrom: Date; validTo: Date },
  now = new Date(),
): PermitState {
  switch (row.status) {
    case "DRAFT":
      return "draft";
    case "CLOSED":
      return "closed";
    case "CANCELLED":
      return "cancelled";
    case "ACTIVE":
      return now < row.validFrom ? "scheduled" : now > row.validTo ? "expired" : "active";
  }
}

function precautionsOf(value: Prisma.JsonValue): Precaution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const { label, done } = item as Record<string, unknown>;
    return typeof label === "string" && typeof done === "boolean" ? [{ label, done }] : [];
  });
}

async function views(ctx: AdminContext, rows: PermitRecord[]): Promise<PermitView[]> {
  const workerIds = [...new Set(rows.flatMap((row) => row.workerIds))];
  const memberIds = [
    ...new Set(
      rows.flatMap((row) => [
        ...row.membershipIds,
        row.issuedById,
        ...(row.approvedById === null ? [] : [row.approvedById]),
        ...(row.closedById === null ? [] : [row.closedById]),
      ]),
    ),
  ];
  const [workers, members] = await Promise.all([
    workerIds.length === 0
      ? Promise.resolve([])
      : ctx.db.caeWorker.findMany({
          where: { id: { in: workerIds } },
          select: { id: true, name: true, company: { select: { name: true } } },
        }),
    memberIds.length === 0
      ? Promise.resolve([])
      : ctx.db.membership.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, user: { select: { name: true } } },
        }),
  ]);
  const workerOf = new Map(workers.map((worker) => [worker.id, worker]));
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  const person = (id: string) => ({ id, name: nameOf.get(id) ?? "" });
  const manage = canManageCae(ctx);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    customName: row.customName,
    company: row.company,
    location: row.location,
    description: row.description,
    validFrom: row.validFrom,
    validTo: row.validTo,
    workers: row.workerIds.flatMap((id) => {
      const worker = workerOf.get(id);
      return worker === undefined
        ? []
        : [{ id: worker.id, name: worker.name, company: worker.company.name }];
    }),
    members: row.membershipIds.map(person),
    precautions: precautionsOf(row.precautions),
    status: row.status,
    state: permitState(row),
    issuedBy: person(row.issuedById),
    approved:
      row.approvedAt === null || row.approvedById === null
        ? null
        : { at: row.approvedAt, by: person(row.approvedById) },
    closed:
      row.closedAt === null || row.closedById === null
        ? null
        : { at: row.closedAt, by: person(row.closedById), note: row.closeNote },
    canManage: manage,
  }));
}

async function viewOf(ctx: AdminContext, id: string): Promise<PermitView> {
  const row = await ctx.db.caeWorkPermit.findFirst({ where: { id }, select: permitSelect });
  if (row === null) throw notFound();
  const [view] = await views(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

interface PermitContent {
  type: PermitType;
  customName: string | null;
  companyId: string | null;
  validFrom: Date;
  validTo: Date;
  workerIds: string[];
  membershipIds: string[];
}

/**
 * The permit makes sense: a name for OTHER, its dates in order and not too long, someone on it, the
 * workers from its company and authorized, own staff active. `starting` also checks it hasn't ended.
 */
async function assertContent(
  ctx: AdminContext,
  content: PermitContent,
  starting: boolean,
): Promise<void> {
  const m = caeTexts.messages;
  const bad = (message: string) => new AppError("BAD_REQUEST", { message });
  if (content.type === "OTHER" && (content.customName ?? "") === "") throw bad(m.permitCustomName);
  if (content.validTo <= content.validFrom) throw bad(m.permitDates);
  if (
    content.validTo.getTime() - content.validFrom.getTime() >
    caeLimits.permitMaxDays * 86_400_000
  ) {
    throw bad(m.permitTooLong(caeLimits.permitMaxDays));
  }
  if (starting && content.validTo <= new Date()) throw bad(m.permitEnded);
  const people = content.workerIds.length + content.membershipIds.length;
  if (people === 0) throw bad(m.permitNoPeople);
  if (people > caeLimits.permitMaxPeople)
    throw bad(m.permitTooManyPeople(caeLimits.permitMaxPeople));
  if (content.companyId !== null) {
    const company = await ctx.db.caeCompany.count({
      where: { id: content.companyId, archivedAt: null },
    });
    if (company === 0) throw notFound();
  }
  if (content.workerIds.length > 0) {
    if (content.companyId === null) throw bad(m.permitWorkerCompany);
    const workers = await ctx.db.caeWorker.findMany({
      where: { id: { in: content.workerIds } },
      select: {
        id: true,
        companyId: true,
        name: true,
        blockedAt: true,
        blockedReason: true,
        archivedAt: true,
      },
    });
    if (workers.length !== content.workerIds.length) throw notFound();
    if (workers.some((worker) => worker.companyId !== content.companyId)) {
      throw bad(m.permitWorkerCompany);
    }
    const statuses = await workerStatuses(ctx, workers);
    const denied = workers.find((worker) => statuses.get(worker.id)?.authorized !== true);
    if (denied !== undefined) {
      throw new AppError("CONFLICT", { message: m.permitWorkerNotAuthorized(denied.name) });
    }
  }
  if (content.membershipIds.length > 0) {
    const active = await ctx.db.membership.count({
      where: { id: { in: content.membershipIds }, status: "ACTIVE" },
    });
    if (active !== content.membershipIds.length) throw bad(m.permitMemberInvalid);
  }
}

const unique = (ids: readonly string[]) => [...new Set(ids)];

export async function createPermit(
  ctx: AdminContext,
  input: CreatePermitInput,
): Promise<PermitView> {
  await requireManager(ctx);
  const content: PermitContent = {
    type: input.type,
    customName: input.type === "OTHER" ? (input.customName ?? null) : null,
    companyId: input.companyId ?? null,
    validFrom: new Date(input.validFrom),
    validTo: new Date(input.validTo),
    workerIds: unique(input.workerIds),
    membershipIds: unique(input.membershipIds),
  };
  await assertContent(ctx, content, false);
  const row = await ctx.db.caeWorkPermit.create({
    data: {
      ...content,
      location: input.location,
      description: input.description,
      precautions: input.precautions,
      issuedById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.permit.create",
    entityType: "CaeWorkPermit",
    entityId: row.id,
    metadata: { type: content.type, companyId: content.companyId, location: input.location },
  });
  return await viewOf(ctx, row.id);
}

async function loadPermit(ctx: AdminContext, id: string): Promise<PermitRecord> {
  const row = await ctx.db.caeWorkPermit.findFirst({ where: { id }, select: permitSelect });
  if (row === null) throw notFound();
  return row;
}

export async function updatePermit(
  ctx: AdminContext,
  id: string,
  input: UpdatePermitInput,
): Promise<PermitView> {
  await requireManager(ctx);
  const current = await loadPermit(ctx, id);
  if (current.status !== "DRAFT") {
    throw new AppError("CONFLICT", { message: caeTexts.messages.permitNotDraft });
  }
  const type = input.type ?? current.type;
  const content: PermitContent = {
    type,
    customName:
      type === "OTHER"
        ? input.customName !== undefined
          ? input.customName
          : current.customName
        : null,
    companyId: input.companyId !== undefined ? input.companyId : current.companyId,
    validFrom: input.validFrom === undefined ? current.validFrom : new Date(input.validFrom),
    validTo: input.validTo === undefined ? current.validTo : new Date(input.validTo),
    workerIds: unique(input.workerIds ?? current.workerIds),
    membershipIds: unique(input.membershipIds ?? current.membershipIds),
  };
  await assertContent(ctx, content, false);
  await ctx.db.caeWorkPermit.update({
    where: { id },
    data: {
      ...content,
      ...(input.location === undefined ? {} : { location: input.location }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.precautions === undefined ? {} : { precautions: input.precautions }),
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.permit.update",
    entityType: "CaeWorkPermit",
    entityId: id,
    metadata: { changed: Object.keys(input) },
  });
  return await viewOf(ctx, id);
}

/** Approved with a signature once every precaution is checked: active from then on, within its dates. */
export async function approvePermit(
  ctx: AdminContext,
  id: string,
  input: ApprovePermitInput,
): Promise<PermitView> {
  await requireManager(ctx);
  const current = await loadPermit(ctx, id);
  if (current.status !== "DRAFT") {
    throw new AppError("CONFLICT", { message: caeTexts.messages.permitNotDraft });
  }
  const precautions = input.precautions ?? precautionsOf(current.precautions);
  if (precautions.some((item) => !item.done)) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.permitPrecautionsPending });
  }
  // Checked again now: someone may have stopped being authorized since the draft.
  await assertContent(ctx, current, true);
  const signature = signatureBytes(input.signature);
  await ctx.db.caeWorkPermit.update({
    where: { id },
    data: {
      status: "ACTIVE",
      precautions,
      approvedById: ctx.tenant.membershipId,
      approvedAt: new Date(),
      approvalSignature: new Uint8Array(signature),
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.permit.approve",
    entityType: "CaeWorkPermit",
    entityId: id,
    metadata: { type: current.type, companyId: current.companyId },
  });
  return await viewOf(ctx, id);
}

export async function closePermit(
  ctx: AdminContext,
  id: string,
  note: string | undefined,
): Promise<PermitView> {
  await requireManager(ctx);
  const current = await loadPermit(ctx, id);
  if (current.status !== "ACTIVE") {
    throw new AppError("CONFLICT", { message: caeTexts.messages.permitNotActive });
  }
  await ctx.db.caeWorkPermit.update({
    where: { id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: ctx.tenant.membershipId,
      closeNote: note === undefined || note === "" ? null : note,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.permit.close",
    entityType: "CaeWorkPermit",
    entityId: id,
    metadata: { type: current.type },
  });
  return await viewOf(ctx, id);
}

export async function cancelPermit(
  ctx: AdminContext,
  id: string,
  reason: string,
): Promise<PermitView> {
  await requireManager(ctx);
  const current = await loadPermit(ctx, id);
  if (current.status === "CLOSED" || current.status === "CANCELLED") {
    throw new AppError("CONFLICT", { message: caeTexts.messages.permitClosed });
  }
  await ctx.db.caeWorkPermit.update({
    where: { id },
    data: {
      status: "CANCELLED",
      closedAt: new Date(),
      closedById: ctx.tenant.membershipId,
      closeNote: reason,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.permit.cancel",
    entityType: "CaeWorkPermit",
    entityId: id,
    metadata: { type: current.type, reason },
  });
  return await viewOf(ctx, id);
}

export async function getPermit(ctx: AdminContext, id: string): Promise<PermitView> {
  await requireReader(ctx);
  return await viewOf(ctx, id);
}

export async function listPermits(
  ctx: AdminContext,
  query: ListPermitsQuery,
): Promise<Page<PermitView>> {
  await requireReader(ctx);
  let day: Prisma.CaeWorkPermitWhereInput = {};
  if (query.day !== undefined) {
    const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
    const zone = zoneOf(workspace?.settings);
    day = {
      validFrom: { lte: endOfDayIn(query.day, zone) },
      validTo: { gte: startOfDayIn(query.day, zone) },
    };
  }
  const where: Prisma.CaeWorkPermitWhereInput = {
    ...day,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.caeWorkPermit.findMany({
      where,
      select: permitSelect,
      orderBy: stableOrder({ validFrom: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.caeWorkPermit.count({ where }),
  ]);
  return pageOf(await views(ctx, rows), total, query);
}

/** The active permits each worker is on right now (for the gatehouse). */
export async function activePermitsOf(
  ctx: Pick<AdminContext, "db">,
  workerIds: readonly string[],
): Promise<
  Map<
    string,
    { id: string; type: PermitType; customName: string | null; location: string; validTo: Date }[]
  >
> {
  const result = new Map<
    string,
    { id: string; type: PermitType; customName: string | null; location: string; validTo: Date }[]
  >();
  if (workerIds.length === 0) return result;
  const now = new Date();
  const rows = await ctx.db.caeWorkPermit.findMany({
    where: {
      status: "ACTIVE",
      validFrom: { lte: now },
      validTo: { gte: now },
      workerIds: { hasSome: [...workerIds] },
    },
    select: {
      id: true,
      type: true,
      customName: true,
      location: true,
      validTo: true,
      workerIds: true,
    },
    orderBy: [{ validTo: "asc" }, { id: "asc" }],
  });
  for (const row of rows) {
    for (const id of row.workerIds) {
      if (!workerIds.includes(id)) continue;
      const list = result.get(id) ?? [];
      list.push({
        id: row.id,
        type: row.type,
        customName: row.customName,
        location: row.location,
        validTo: row.validTo,
      });
      result.set(id, list);
    }
  }
  return result;
}

/** The permit as a PDF, with whoever approved's signature. */
export async function permitPdf(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  id: string,
): Promise<{ fileName: string; body: Uint8Array }> {
  await requireReader(ctx);
  if (deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: formMessages.pdfUnavailable });
  }
  const view = await viewOf(ctx, id);
  const stored = await ctx.db.caeWorkPermit.findFirst({
    where: { id },
    select: { approvalSignature: true },
  });
  const workspace = await ctx.db.workspace.findFirst({
    where: {},
    select: { name: true, settings: true },
  });
  const zone = zoneOf(workspace?.settings);
  const locale = currentLocale();
  const when = (date: Date) => formatDateTimeIn(date, zone, locale);
  const p = caeTexts.permits;
  const t = p.pdf;
  const typeName = view.type === "OTHER" ? (view.customName ?? p.types.OTHER) : p.types[view.type];
  const facts = [
    [t.type, typeName],
    [t.status, p.statuses[view.status]],
    [t.company, view.company?.name ?? t.ownCompany],
    [t.location, view.location],
    [t.from, when(view.validFrom)],
    [t.to, when(view.validTo)],
    [t.issuedBy, view.issuedBy.name],
    ...(view.approved === null
      ? []
      : [[t.approvedBy, `${view.approved.by.name} · ${when(view.approved.at)}`]]),
  ]
    .map(
      ([label = "", value = ""]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const people = [
    ...view.workers.map((worker) => `${worker.name} (${worker.company})`),
    ...view.members.map((member) => member.name),
  ]
    .map((name) => `<li>${escapeHtml(name)}</li>`)
    .join("");
  const precautions = view.precautions
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.done ? t.done : t.notDone)}</td></tr>`,
    )
    .join("");
  const ending =
    view.closed === null
      ? ""
      : `<p><strong>${escapeHtml(
          view.status === "CANCELLED"
            ? t.cancelled(when(view.closed.at), view.closed.by.name)
            : t.closed(when(view.closed.at), view.closed.by.name),
        )}</strong>${view.closed.note === null ? "" : ` ${escapeHtml(view.closed.note)}`}</p>`;
  const signature =
    stored?.approvalSignature == null
      ? ""
      : `<div class="sign"><p>${escapeHtml(t.signature)}</p><img alt="" src="data:image/png;base64,${Buffer.from(
          stored.approvalSignature,
        ).toString("base64")}"><p>${escapeHtml(view.approved?.by.name ?? "")}</p></div>`;
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; }
    h1 { font-size: 17pt; margin: 0 0 .2em; } h2 { font-size: 12pt; margin: 1.2em 0 .4em; }
    .muted { color: #555; margin: 0 0 1.2em; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
    th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; }
    th { background: #f3f3f3; font-weight: normal; } table.facts th { width: 30%; }
    .sign img { height: 90px; border-bottom: 1px solid #888; }
  `;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body>
<h1>${escapeHtml(`${t.title}: ${typeName}`)}</h1><p class="muted">${escapeHtml(workspace?.name ?? "")}</p>
<table class="facts">${facts}</table>
${view.description === "" ? "" : `<h2>${escapeHtml(t.description)}</h2><p>${escapeHtml(view.description)}</p>`}
<h2>${escapeHtml(t.people)}</h2><ul>${people}</ul>
${precautions === "" ? "" : `<h2>${escapeHtml(t.precautions)}</h2><table><tbody>${precautions}</tbody></table>`}
${ending}${signature}
</body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const body = await renderWithGotenberg(deps.gotenbergUrl, {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(`${t.title} · ${typeName}`)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${t.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  await auditAdmin(ctx, {
    action: "cae.permit.export",
    entityType: "CaeWorkPermit",
    entityId: id,
    metadata: { type: view.type },
  });
  return { fileName: t.fileName(typeName, view.validFrom.toISOString().slice(0, 10)), body };
}
