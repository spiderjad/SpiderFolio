// /api/v1/w/:slug/bian — Bian, el asistente IA. Cualquier miembro puede preguntar (lectores
// incluidos); los invitados solo si el propietario lo habilitó. Lo hace cumplir el servicio.
import type { Request, RequestHandler } from "express";
import type { Logger } from "pino";
import { z } from "zod";
import { errorMessages, validationMessages } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf, type AdminContext } from "../admin/admin-context.ts";
import { askBian, bianAvailability, type BianDeps, type BianEvent } from "./ask.service.ts";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import {
  bianOverview,
  bianUsage,
  bianUsageCsv,
  removeLimit,
  setLimit,
  updateBianSettings,
  setMonthlyTotal,
} from "./bian-admin.service.ts";
import { requestMoreQueries } from "./usage.service.ts";
import {
  FEEDBACK_REASONS,
  feedbackStats,
  removeFeedback,
  saveFeedback,
  updateFeedback,
} from "./feedback.service.ts";
import { draftPageWithBian, templateIds } from "./draft.service.ts";
import { explainChanges, summarizeDocument } from "./tasks.service.ts";
import { getAiUsage } from "./usage.service.ts";

const AskSchema = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  history: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(6)
    .default([]),
});

const FeedbackSchema = z.strictObject({
  rating: z.enum(["UP", "DOWN"]),
  reason: z.enum(FEEDBACK_REASONS).optional(),
  nodeIds: z.array(z.string().min(1).max(40)).max(20).default([]),
});

const FeedbackUpdateSchema = z
  .strictObject({
    rating: z.enum(["UP", "DOWN"]).optional(),
    reason: z.enum(FEEDBACK_REASONS).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

const FeedbackParamsSchema = z.object({ id: z.string().min(1).max(40) });

/** Administrar Bian: seguridad o ajustes de la empresa. */
const adminCapabilities = ["security.manage", "workspace.settings"] as const;

/** Total de consultas por mes de toda la empresa; null = sin límite. */
const MonthlyTotalSchema = z.strictObject({
  total: z.int().min(0).max(1_000_000_000).nullable(),
});

const FeedbackStatsQuerySchema = z.object({
  rating: z.enum(["UP", "DOWN"]).optional(),
  q: SearchParam,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...pageShape(["down"], "down", { defaultPageSize: 25 }),
});

const BianSettingsSchema = z
  .strictObject({ enabled: z.boolean().optional(), guests: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

const SetLimitSchema = z.strictObject({
  scope: z.enum(["GENERAL", "DEPARTMENT", "PERSON"]),
  subjectId: z.string().min(1).max(40).optional(),
  mode: z.enum(["LIMIT", "UNLIMITED", "BLOCKED"]),
  limit: z.number().int().min(0).max(1_000_000).optional(),
});

const UsageQuerySchema = z.object({
  view: z.enum(["people", "departments"]).default("people"),
  q: SearchParam,
  ...pageShape(["name", "used", "limit"], "name", { defaultPageSize: 25 }),
});

const DraftSchema = z.strictObject({
  spaceId: z.string().min(1).max(40),
  parentId: z.string().min(1).max(40).nullable().default(null),
  templateId: z.enum(templateIds),
  notes: z.string().trim().min(1).max(4000),
});

const SummarizeSchema = z.strictObject({ nodeId: z.string().min(1).max(40) });

const ChangesSchema = z.strictObject({
  nodeId: z.string().min(1).max(40),
  from: z.number().int().min(1).optional(),
  to: z.number().int().min(1).optional(),
});

type Run = (
  ctx: AdminContext,
  req: Request,
  send: (event: BianEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

/** Respuesta en streaming (SSE); los errores antes del primer evento salen como JSON normal. */
function streaming(logger: Logger, run: Run): RequestHandler {
  return async (req, res) => {
    const ctx = adminContextOf(req);
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const state = { started: false };
    const send = (event: BianEvent) => {
      if (!state.started) {
        state.started = true;
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
      }
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await run(ctx, req, send, controller.signal);
    } catch (error) {
      if (!state.started) throw error;
      // Ya se mandó la cabecera del stream: el error viaja como evento (la conexión no se corta).
      const known = error instanceof AppError ? error : null;
      if (known === null) logger.error({ err: error, requestId: req.requestId }, "Error en Bian");
      send({
        type: "error",
        code: known?.code ?? "INTERNAL",
        message: known?.message ?? errorMessages.INTERNAL,
      });
    }
    if (state.started) res.end();
  };
}

export function bianRoutes(deps: AppDeps): TenantRoute[] {
  const bian: BianDeps = { ...deps, anthropic: deps.anthropic ?? null };
  const personKey = (req: Request) =>
    `${req.tenant?.workspaceId ?? clientIp(req)}:${req.auth?.userId ?? clientIp(req)}`;
  // 20 pedidos a Bian por minuto por persona (además de los límites de consultas).
  const askLimit = sensitiveRateLimit(deps, {
    name: "bian-ask",
    windowMs: 60_000,
    limit: 20,
    key: personKey,
  });
  const feedbackLimit = sensitiveRateLimit(deps, {
    name: "bian-feedback",
    windowMs: 60_000,
    limit: 60,
    key: personKey,
  });

  return [
    {
      method: "get",
      path: "/bian/usage",
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        res.json({
          availability: await bianAvailability(ctx, bian),
          usage: await getAiUsage(ctx, bian),
        });
      },
    },
    {
      method: "post",
      path: "/bian/feedback",
      guards: [feedbackLimit],
      handler: async (req, res) => {
        res
          .status(201)
          .json(await saveFeedback(adminContextOf(req), FeedbackSchema.parse(req.body)));
      },
    },
    {
      method: "patch",
      path: "/bian/feedback/:id",
      guards: [feedbackLimit],
      handler: async (req, res) => {
        const { id } = FeedbackParamsSchema.parse(req.params);
        await updateFeedback(adminContextOf(req), id, FeedbackUpdateSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "delete",
      path: "/bian/feedback/:id",
      guards: [feedbackLimit],
      handler: async (req, res) => {
        const { id } = FeedbackParamsSchema.parse(req.params);
        await removeFeedback(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/admin/bian/feedback",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        res.json(
          await feedbackStats(adminContextOf(req), deps, FeedbackStatsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/bian/request-more",
      guards: [feedbackLimit],
      handler: async (req, res) => {
        res.json(await requestMoreQueries(adminContextOf(req)));
      },
    },
    {
      method: "get",
      path: "/admin/bian/overview",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        res.json(await bianOverview(adminContextOf(req)));
      },
    },
    {
      method: "put",
      path: "/admin/bian/total",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        await setMonthlyTotal(ctx, MonthlyTotalSchema.parse(req.body).total);
        res.json(await bianOverview(ctx));
      },
    },
    {
      method: "patch",
      path: "/admin/bian/settings",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        res.json({
          settings: await updateBianSettings(
            adminContextOf(req),
            BianSettingsSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "put",
      path: "/admin/bian/limits",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        res.json({ limit: await setLimit(adminContextOf(req), SetLimitSchema.parse(req.body)) });
      },
    },
    {
      method: "delete",
      path: "/admin/bian/limits/:id",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        const { id } = FeedbackParamsSchema.parse(req.params);
        await removeLimit(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/admin/bian/usage",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        res.json(await bianUsage(adminContextOf(req), UsageQuerySchema.parse(req.query)));
      },
    },
    {
      // Antes de /usage/:algo no hay conflicto: es una ruta propia.
      method: "get",
      path: "/admin/bian/usage/export",
      anyCapability: adminCapabilities,
      handler: async (req, res) => {
        const file = await bianUsageCsv(adminContextOf(req), UsageQuerySchema.parse(req.query));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="bian-uso.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.csv);
      },
    },
    {
      method: "post",
      path: "/bian/ask",
      guards: [askLimit],
      handler: streaming(deps.logger, async (ctx, req, send, signal) => {
        await askBian(ctx, bian, AskSchema.parse(req.body), send, signal);
      }),
    },
    {
      method: "post",
      path: "/bian/draft",
      guards: [askLimit],
      handler: async (req, res) => {
        const input = DraftSchema.parse(req.body);
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const result = await draftPageWithBian(
          adminContextOf(req),
          bian,
          input,
          controller.signal,
        );
        res.status(201).json(result);
      },
    },
    {
      method: "post",
      path: "/bian/summarize",
      guards: [askLimit],
      handler: streaming(deps.logger, async (ctx, req, send, signal) => {
        await summarizeDocument(ctx, bian, SummarizeSchema.parse(req.body), send, signal);
      }),
    },
    {
      method: "post",
      path: "/bian/changes",
      guards: [askLimit],
      handler: streaming(deps.logger, async (ctx, req, send, signal) => {
        await explainChanges(ctx, bian, ChangesSchema.parse(req.body), send, signal);
      }),
    },
  ];
}
