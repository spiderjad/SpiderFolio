// What an audit room can share (docs/spec/salas-de-auditoria.md) and whether its creator still sees it:
// checked when it's added and again each time the auditor opens it, with the creator's own access and
// capabilities (a room never shows more than its creator sees).
import { auditRoomTexts } from "../../i18n/index.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { atLeast } from "../access/access.ts";
import { accessFor, levelOfNode } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { getControlled } from "../documents/documents.service.ts";
import { ReadingsQuerySchema } from "../documents/documents.schemas.ts";
import { readingsOverview } from "../documents/readings.service.ts";
import { canManageSafety, requireSafety, safetySettingsOf } from "../safety/safety-access.ts";
import { formatUtcDay } from "../../lib/time-zone.ts";
import { currentLocale } from "../../i18n/locales.ts";
import type { RoomItemInput } from "./rooms.schemas.ts";

export interface ItemRow {
  kind: "NODE" | "SPACE" | "REPORT";
  nodeId: string | null;
  spaceId: string | null;
  report: RoomItemInput["kind"] | null;
  params: Record<string, string>;
  title: string;
}

const day = (value: string) => formatUtcDay(new Date(`${value}T12:00:00Z`), currentLocale());

function range(input: { from: string; to: string }) {
  if (input.from > input.to) throw new AppError("BAD_REQUEST");
}

async function controlledTitle(ctx: AdminContext, nodeId: string): Promise<string> {
  const info = await getControlled(ctx, nodeId);
  if (info.controlled === null) {
    throw new AppError("BAD_REQUEST", { message: auditRoomTexts.errors.notShareable });
  }
  const node = await ctx.db.node.findFirst({ where: { id: nodeId }, select: { name: true } });
  return `${info.controlled.code} ${node?.name ?? ""}`.trim();
}

/** Checks the creator may share it and returns what's stored (and shown) for it. */
export async function describeItem(ctx: AdminContext, input: RoomItemInput): Promise<ItemRow> {
  const t = auditRoomTexts.reports;
  const base = { nodeId: null, spaceId: null, report: null, params: {} };
  switch (input.kind) {
    case "node": {
      const node = await ctx.db.node.findFirst({
        where: { id: input.nodeId, trashedAt: null },
        select: { id: true, name: true, type: true },
      });
      if (node === null || !atLeast(await levelOfNode(ctx, node.id), "VIEW")) throw notFound();
      // A form's answers go as a report (with dates), never the form itself.
      if (node.type === "FORM") {
        throw new AppError("BAD_REQUEST", { message: auditRoomTexts.errors.notShareable });
      }
      return { ...base, kind: "NODE", nodeId: node.id, title: node.name };
    }
    case "space": {
      const space = await ctx.db.space.findFirst({
        where: { id: input.spaceId },
        select: { id: true, name: true },
      });
      const access = await accessFor(ctx, { spaceIds: [input.spaceId] });
      if (space === null || !atLeast(access.ofSpace(space.id), "VIEW")) throw notFound();
      return { ...base, kind: "SPACE", spaceId: space.id, title: space.name };
    }
    case "readings": {
      const title = await controlledTitle(ctx, input.nodeId);
      // Throws without the capability (or the department) to see the compliance.
      await readingsOverview(ctx, input.nodeId, ReadingsQuerySchema.parse({ pageSize: 1 }));
      return {
        ...base,
        kind: "REPORT",
        report: "readings",
        nodeId: input.nodeId,
        params: { nodeId: input.nodeId },
        title: t.readings(title),
      };
    }
    case "approvals": {
      const title = await controlledTitle(ctx, input.nodeId);
      return {
        ...base,
        kind: "REPORT",
        report: "approvals",
        nodeId: input.nodeId,
        params: { nodeId: input.nodeId },
        title: t.approvals(title),
      };
    }
    case "form-records": {
      range(input);
      const form = await ctx.db.node.findFirst({
        where: { id: input.formId, type: "FORM", trashedAt: null },
        select: { id: true, name: true },
      });
      if (form === null || !atLeast(await levelOfNode(ctx, form.id), "VIEW")) throw notFound();
      // The accident form is health data: never in a room.
      if ((await safetySettingsOf(ctx.db)).incidentFormId === form.id) {
        throw new AppError("BAD_REQUEST", { message: auditRoomTexts.errors.notShareable });
      }
      return {
        ...base,
        kind: "REPORT",
        report: "form-records",
        nodeId: form.id,
        params: { formId: form.id, from: input.from, to: input.to },
        title: t.formRecords(form.name, day(input.from), day(input.to)),
      };
    }
    case "training": {
      await requireSafety(ctx);
      if (!canManageSafety(ctx)) throw forbidden();
      const course = await ctx.db.safetyCourse.findFirst({
        where: { id: input.courseId },
        select: { id: true, nodeId: true },
      });
      if (course === null) throw notFound();
      const title = await controlledTitle(ctx, course.nodeId);
      return {
        ...base,
        kind: "REPORT",
        report: "training",
        params: { courseId: course.id },
        title: t.training(title),
      };
    }
    case "ppe": {
      range(input);
      await requireSafety(ctx);
      if (!canManageSafety(ctx)) throw forbidden();
      return {
        ...base,
        kind: "REPORT",
        report: "ppe",
        params: { from: input.from, to: input.to },
        title: t.ppe(day(input.from), day(input.to)),
      };
    }
    case "audit-log": {
      range(input);
      if (!ctx.tenant.capabilities.includes("audit.view")) throw forbidden();
      return {
        ...base,
        kind: "REPORT",
        report: "audit-log",
        params: {
          from: input.from,
          to: input.to,
          ...(input.action === undefined ? {} : { action: input.action }),
        },
        title: t.auditLog(day(input.from), day(input.to)),
      };
    }
  }
}

/** A stored item as the input it came from (to check it again when the auditor opens it). */
export function inputOf(item: ItemRow): RoomItemInput {
  const p = item.params;
  switch (item.report ?? (item.kind === "NODE" ? "node" : "space")) {
    case "node":
      return { kind: "node", nodeId: item.nodeId ?? "" };
    case "space":
      return { kind: "space", spaceId: item.spaceId ?? "" };
    case "readings":
      return { kind: "readings", nodeId: p.nodeId ?? "" };
    case "approvals":
      return { kind: "approvals", nodeId: p.nodeId ?? "" };
    case "form-records":
      return { kind: "form-records", formId: p.formId ?? "", from: p.from ?? "", to: p.to ?? "" };
    case "training":
      return { kind: "training", courseId: p.courseId ?? "" };
    case "ppe":
      return { kind: "ppe", from: p.from ?? "", to: p.to ?? "" };
    case "audit-log":
      return {
        kind: "audit-log",
        from: p.from ?? "",
        to: p.to ?? "",
        ...(p.action === undefined ? {} : { action: p.action }),
      };
  }
}
