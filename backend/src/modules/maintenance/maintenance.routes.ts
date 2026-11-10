// The maintenance module (docs/spec/mantenimiento.md): /admin/maintenance turns it on or off (only the
// owner); /maintenance/* is the module itself. Every service checks the module is on and who sees what.
import { maintenanceLimits } from "@spiderfolio/limits";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { pageShape } from "../../lib/pagination.ts";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { assetQr, createAsset, getAsset, listAssets, updateAsset } from "./assets.service.ts";
import { rateSuggestion, suggestResolution } from "./suggest.service.ts";
import { requireAny } from "./maintenance-access.ts";
import { getMaintenanceSettings, updateMaintenanceSettings } from "./maintenance.service.ts";
import {
  addReading,
  calibrationPlans,
  createMeter,
  createPlan,
  listMeters,
  listPlans,
  updatePlan,
} from "./plans.service.ts";
import {
  closeByVoice,
  recordingAudio,
  reportByVoice,
  voiceStatus,
  type VoiceDeps,
  type VoiceInput,
} from "./voice.service.ts";
import {
  actOnWorkOrder,
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
  reportWorkOrder,
  updateWorkOrder,
  workOrderCounts,
  type WorkAction,
} from "./work-orders.service.ts";

const L = maintenanceLimits;
const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Short = z.string().trim().max(L.shortMax);
const Text = z.string().trim().max(L.textMax);
const IdParams = z.object({ id: Id });

const kinds = ["CORRECTIVE", "PREVENTIVE", "IMPROVEMENT", "SAFETY", "HYGIENE"] as const;
const priorities = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
const statuses = [
  "REPORTED",
  "PLANNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "DONE",
  "CLOSED",
  "CANCELLED",
] as const;

const AssetSchema = z.strictObject({
  code: z.string().trim().min(1).max(L.codeMax),
  name: z.string().trim().min(1).max(L.nameMax),
  parentId: Id.nullable().default(null),
  location: Short.default(""),
  manufacturer: Short.default(""),
  model: Short.default(""),
  serial: Short.default(""),
  installedOn: Day.nullable().default(null),
  criticality: z.enum(["A", "B", "C"]).default("B"),
  foodContact: z.boolean().default(false),
  status: z.enum(["OPERATING", "STOPPED", "RETIRED"]).default("OPERATING"),
  notes: Text.default(""),
});
const AssetUpdateSchema = AssetSchema.extend({ archived: z.boolean().optional() });
const ArchivedQuery = z.object({ archivado: z.enum(["0", "1"]).default("0") });
const QrQuery = z.object({ format: z.enum(["png", "svg"]).default("png") });

const ReportSchema = z.strictObject({
  title: z.string().trim().min(1).max(L.nameMax),
  description: Text.default(""),
  assetId: Id.nullable().default(null),
  priority: z.enum(priorities).default("NORMAL"),
  source: z.enum(["APP", "QR"]).default("APP"),
  recordingId: Id.nullable().default(null),
});
const WorkOrderSchema = z.strictObject({
  title: z.string().trim().min(1).max(L.nameMax),
  description: Text.default(""),
  assetId: Id.nullable().default(null),
  kind: z.enum(kinds).default("CORRECTIVE"),
  priority: z.enum(priorities).default("NORMAL"),
  assignedToId: Id.nullable().default(null),
  dueOn: Day.nullable().default(null),
  lockout: z.boolean().default(false),
});

const WorkOrdersQuery = z.object({
  ...pageShape(["reportedAt"], "reportedAt"),
  estado: z.enum(["open", ...statuses]).optional(),
  prioridad: z.enum(priorities).optional(),
  tipo: z.enum(kinds).optional(),
  equipo: Id.optional(),
  mias: z.enum(["1"]).optional(),
  q: z.string().trim().max(L.shortMax).optional(),
});

const ActionSchema: z.ZodType<WorkAction> = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("take") }),
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("stop"), note: Text.default("") }),
  z.strictObject({ action: z.literal("hold"), reason: z.string().trim().min(1).max(L.shortMax) }),
  z.strictObject({ action: z.literal("resume") }),
  z.strictObject({
    action: z.literal("done"),
    cause: Text.default(""),
    solution: z.string().trim().min(1).max(L.textMax),
    downtimeMinutes: z.number().int().min(0).max(100_000).nullable().default(null),
  }),
  z.strictObject({ action: z.literal("release_hygiene") }),
  z.strictObject({ action: z.literal("close") }),
  z.strictObject({ action: z.literal("reopen") }),
  z.strictObject({ action: z.literal("cancel"), reason: z.string().trim().min(1).max(L.shortMax) }),
  z.strictObject({
    action: z.literal("labor"),
    minutes: z.number().int().min(1).max(L.laborMinutesMax),
    note: Text.default(""),
    day: Day,
  }),
  z.strictObject({ action: z.literal("remove_labor"), laborId: Id }),
  z.strictObject({
    action: z.literal("part"),
    partCode: Short.default(""),
    description: z.string().trim().min(1).max(L.nameMax),
    quantity: z.number().positive().max(L.quantityMax),
    unit: z.string().trim().min(1).max(20).default("ud"),
  }),
  z.strictObject({ action: z.literal("remove_part"), partId: Id }),
  z.strictObject({
    action: z.literal("check"),
    index: z.number().int().min(0).max(L.planStepsMax),
    done: z.boolean(),
  }),
]);

// Preventive plans and meters (section 5).
const Count = (max: number) => z.number().int().min(1).max(max);
const PlanSchema = z.strictObject({
  assetId: Id,
  kind: z.enum(["PREVENTIVE", "CALIBRATION"]).default("PREVENTIVE"),
  name: z.string().trim().min(1).max(L.nameMax),
  instructions: Text.default(""),
  checklist: z.array(z.string().trim().max(L.planStepMax)).max(L.planStepsMax).default([]),
  every: Count(L.planEveryMax).nullable().default(null),
  everyUnit: z.enum(["DAYS", "WEEKS", "MONTHS"]).nullable().default(null),
  firstDueOn: Day.nullable().default(null),
  meterId: Id.nullable().default(null),
  meterEvery: Count(L.meterValueMax).nullable().default(null),
  firstMeterAt: z.number().int().min(0).max(L.meterValueMax).nullable().default(null),
  assignedToId: Id.nullable().default(null),
  estimatedMinutes: Count(L.laborMinutesMax).nullable().default(null),
  leadDays: z.number().int().min(0).max(L.planLeadDaysMax).default(3),
  lockout: z.boolean().default(false),
});
const PlanUpdateSchema = PlanSchema.extend({ archived: z.boolean().optional() });
const MeterSchema = z.strictObject({
  assetId: Id,
  name: z.string().trim().min(1).max(L.shortMax),
  unit: z.string().trim().min(1).max(20),
});
const ReadingSchema = z.strictObject({ value: z.number().int().min(0).max(L.meterValueMax) });

const archivedOf = (req: Request) => ArchivedQuery.parse(req.query).archivado === "1";

// A voice note: the audio as the raw body (audio/*), or the dictated or typed text as JSON.
const VoiceTextSchema = z.strictObject({ text: z.string().min(1).max(L.textMax) });
const VoiceQuery = z.object({
  equipo: Id.optional(),
  duracion: z.coerce
    .number()
    .int()
    .min(0)
    .max(L.audioMaxSeconds * 1000 + 60_000)
    .optional(),
});

function voiceInputOf(req: Request): VoiceInput {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length === 0) throw new AppError("BAD_REQUEST");
    return {
      kind: "audio",
      audio: req.body,
      contentType: req.headers["content-type"] ?? "",
      durationMs: VoiceQuery.parse(req.query).duracion ?? null,
    };
  }
  return { kind: "text", text: VoiceTextSchema.parse(req.body).text };
}

/** Aborts the AI calls when the person leaves. */
function abortOnClose(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

export function maintenanceRoutes(deps: AppDeps): TenantRoute[] {
  const voice: VoiceDeps = { ...deps, anthropic: deps.anthropic ?? null };
  // 12 voice notes a minute per person (besides the company's AI queries).
  const voiceLimit = sensitiveRateLimit(deps, {
    name: "maintenance-voice",
    windowMs: 60_000,
    limit: 12,
    key: (req) =>
      `${req.tenant?.workspaceId ?? clientIp(req)}:${req.auth?.userId ?? clientIp(req)}`,
  });
  const audioBody = express.raw({ type: "audio/*", limit: L.audioMaxBytes });
  return [
    {
      method: "get",
      path: "/admin/maintenance",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json({ maintenance: await getMaintenanceSettings(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/admin/maintenance",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        const input = z.strictObject({ enabled: z.boolean() }).parse(req.body);
        res.json({ maintenance: await updateMaintenanceSettings(adminContextOf(req), input) });
      },
    },
    // ─── Assets ───
    {
      method: "get",
      path: "/maintenance/assets",
      handler: async (req, res) => {
        res.json({ assets: await listAssets(adminContextOf(req), { archived: archivedOf(req) }) });
      },
    },
    {
      method: "post",
      path: "/maintenance/assets",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ asset: await createAsset(adminContextOf(req), AssetSchema.parse(req.body)) });
      },
    },
    {
      method: "get",
      path: "/maintenance/assets/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ asset: await getAsset(adminContextOf(req), id) });
      },
    },
    {
      method: "put",
      path: "/maintenance/assets/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          asset: await updateAsset(adminContextOf(req), id, AssetUpdateSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/maintenance/assets/:id/qr",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { format } = QrQuery.parse(req.query);
        const file = await assetQr(adminContextOf(req), deps.env.APP_URL, id, format);
        res.setHeader("Content-Type", file.contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.body);
      },
    },
    // ─── Voice (section 3) ───
    {
      method: "get",
      path: "/maintenance/voice",
      handler: async (req, res) => {
        res.json({ voice: await voiceStatus(adminContextOf(req), voice) });
      },
    },
    {
      method: "post",
      path: "/maintenance/voice/report",
      guards: [voiceLimit, audioBody],
      handler: async (req, res) => {
        const input = voiceInputOf(req);
        const assetId = VoiceQuery.parse(req.query).equipo ?? null;
        res.json(
          await reportByVoice(adminContextOf(req), voice, input, assetId, abortOnClose(res)),
        );
      },
    },
    {
      method: "post",
      path: "/maintenance/work-orders/:id/voice",
      guards: [voiceLimit, audioBody],
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const input = voiceInputOf(req);
        res.json(await closeByVoice(adminContextOf(req), voice, id, input, abortOnClose(res)));
      },
    },
    // ─── Suggest a resolution (section 4) ───
    {
      method: "post",
      path: "/maintenance/work-orders/:id/suggestion",
      guards: [voiceLimit],
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          suggestion: await suggestResolution(adminContextOf(req), voice, id, abortOnClose(res)),
        });
      },
    },
    {
      method: "put",
      path: "/maintenance/work-orders/:id/suggestion/:suggestionId",
      handler: async (req, res) => {
        const { id, suggestionId } = z.object({ id: Id, suggestionId: Id }).parse(req.params);
        const { useful } = z.strictObject({ useful: z.boolean() }).parse(req.body);
        await rateSuggestion(adminContextOf(req), id, suggestionId, useful);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/maintenance/recordings/:id/audio",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const audio = await recordingAudio(adminContextOf(req), voice, id);
        res.setHeader("Content-Type", audio.contentType);
        res.setHeader("Content-Length", String(audio.size));
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        audio.stream.pipe(res);
      },
    },
    // ─── Preventive (section 5) ───
    {
      method: "get",
      path: "/maintenance/plans",
      handler: async (req, res) => {
        res.json({ plans: await listPlans(adminContextOf(req), { archived: archivedOf(req) }) });
      },
    },
    {
      method: "post",
      path: "/maintenance/plans",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ plan: await createPlan(adminContextOf(req), PlanSchema.parse(req.body)) });
      },
    },
    {
      method: "put",
      path: "/maintenance/plans/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          plan: await updatePlan(adminContextOf(req), id, PlanUpdateSchema.parse(req.body)),
        });
      },
    },
    {
      // Quality's calibration prerequisite reads them here (decision 5).
      method: "get",
      path: "/maintenance/calibrations",
      handler: async (req, res) => {
        res.json({ plans: await calibrationPlans(adminContextOf(req)) });
      },
    },
    {
      method: "get",
      path: "/maintenance/meters",
      handler: async (req, res) => {
        res.json({ meters: await listMeters(adminContextOf(req)) });
      },
    },
    {
      method: "post",
      path: "/maintenance/meters",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ meter: await createMeter(adminContextOf(req), MeterSchema.parse(req.body)) });
      },
    },
    {
      method: "post",
      path: "/maintenance/meters/:id/readings",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { value } = ReadingSchema.parse(req.body);
        res.json({ meter: await addReading(adminContextOf(req), id, value) });
      },
    },
    // ─── Technicians (to assign) ───
    {
      method: "get",
      path: "/maintenance/technicians",
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        await requireAny(ctx);
        const rows = await ctx.db.membership.findMany({
          where: {
            status: "ACTIVE",
            role: { capabilities: { hasSome: ["maintenance.work", "maintenance.manage"] } },
          },
          select: { id: true, user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
          take: 500,
        });
        res.json({ technicians: rows.map((row) => ({ id: row.id, name: row.user.name })) });
      },
    },
    // ─── Work orders ───
    {
      method: "get",
      path: "/maintenance/work-orders",
      handler: async (req, res) => {
        const query = WorkOrdersQuery.parse(req.query);
        res.json(
          await listWorkOrders(adminContextOf(req), {
            page: query.page,
            pageSize: query.pageSize,
            cursor: query.cursor,
            status: query.estado,
            priority: query.prioridad,
            kind: query.tipo,
            assetId: query.equipo,
            mine: query.mias === "1",
            q: query.q,
          }),
        );
      },
    },
    {
      method: "get",
      path: "/maintenance/counts",
      handler: async (req, res) => {
        res.json(await workOrderCounts(adminContextOf(req)));
      },
    },
    {
      method: "post",
      path: "/maintenance/reports",
      handler: async (req, res) => {
        res.status(201).json({
          workOrder: await reportWorkOrder(adminContextOf(req), ReportSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/maintenance/work-orders",
      handler: async (req, res) => {
        res.status(201).json({
          workOrder: await createWorkOrder(adminContextOf(req), {
            ...WorkOrderSchema.parse(req.body),
            source: "APP",
          }),
        });
      },
    },
    {
      method: "get",
      path: "/maintenance/work-orders/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ workOrder: await getWorkOrder(adminContextOf(req), id) });
      },
    },
    {
      method: "put",
      path: "/maintenance/work-orders/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          workOrder: await updateWorkOrder(
            adminContextOf(req),
            id,
            WorkOrderSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/maintenance/work-orders/:id/actions",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          workOrder: await actOnWorkOrder(adminContextOf(req), id, ActionSchema.parse(req.body)),
        });
      },
    },
  ];
}
