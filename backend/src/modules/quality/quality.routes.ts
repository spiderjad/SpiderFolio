// The food quality module (docs/spec/calidad.md): /admin/quality turns it on or off (only the owner);
// /quality/* is the module itself. Every service checks the module is on and who sees what.
import type { Request } from "express";
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  addAction,
  cancelNc,
  completeQualityAction,
  createNc,
  createNcFromRecord,
  exportNcsCsv,
  getNc,
  listNcs,
  listQualityActions,
  ncEvents,
  ncFolder,
  ncOfRecord,
  qualitySummary,
  reopenNc,
  reportNc,
  setVerifyOn,
  updateNc,
  updateQualityAction,
  verifyNc,
} from "./ncs.service.ts";
import {
  ActionSchema,
  CompleteActionSchema,
  CreateNcSchema,
  FromRecordSchema,
  ListActionsQuerySchema,
  ListNcsQuerySchema,
  NcFiltersSchema,
  ReasonSchema,
  ReportNcSchema,
  UpdateActionSchema,
  UpdateNcSchema,
  UpdateQualitySchema,
  VerificationSchema,
  VerifyOnSchema,
} from "./quality.schemas.ts";
import { getQualitySettings, loadTemplate, updateQualitySettings } from "./quality.service.ts";
import {
  ArchiveSchema,
  CcpSchema,
  DecisionSchema,
  HaccpQuerySchema,
  HoldSchema,
  ListHoldsQuerySchema,
  OrderSchema,
  UpdateCcpSchema,
} from "./haccp.schemas.ts";
import {
  ccpFormOptions,
  createCcp,
  haccpOverview,
  orderCcps,
  setCcpArchived,
  updateCcp,
} from "./haccp.service.ts";
import { createHold, decideHold, getHold, listHolds } from "./holds.service.ts";
import {
  AuditSchema,
  AuditsQuerySchema,
  CoverageQuerySchema,
  DoneSchema,
  FindingNcSchema,
  FindingSchema,
  UpdateAuditSchema,
} from "./audits.schemas.ts";
import {
  addFinding,
  auditCoverage,
  cancelAudit,
  closeAudit,
  createAudit,
  findingNc,
  getAudit,
  listAudits,
  updateAudit,
} from "./audits.service.ts";
import { FormQualitySchema, getFormQuality, saveFormQuality } from "./quality-forms.ts";

const IdParams = z.object({ id: z.string().min(1).max(64) });
const HOUR = 3_600_000;
const FormOptionsQuery = z.object({ q: z.string().trim().max(100).default("") });

export function qualityRoutes(deps: Pick<AppDeps, "prisma" | "env">): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    {
      method: "get",
      path: "/admin/quality",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json({ quality: await getQualitySettings(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/admin/quality",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        const changes = UpdateQualitySchema.parse(req.body);
        res.json({ quality: await updateQualitySettings(adminContextOf(req), changes) });
      },
    },
    {
      method: "get",
      path: "/quality/summary",
      handler: async (req, res) => {
        res.json(await qualitySummary(adminContextOf(req)));
      },
    },
    {
      method: "get",
      path: "/quality/ncs",
      handler: async (req, res) => {
        res.json(await listNcs(adminContextOf(req), ListNcsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/quality/ncs",
      handler: async (req, res) => {
        const nc = await createNc(adminContextOf(req), CreateNcSchema.parse(req.body));
        res.status(201).json({ nc });
      },
    },
    {
      method: "post",
      path: "/quality/ncs/report",
      handler: async (req, res) => {
        const nc = await reportNc(adminContextOf(req), ReportNcSchema.parse(req.body));
        res.status(201).json({ nc });
      },
    },
    {
      method: "post",
      path: "/quality/ncs/from-record",
      handler: async (req, res) => {
        const { recordId } = FromRecordSchema.parse(req.body);
        res.status(201).json({ nc: await createNcFromRecord(adminContextOf(req), recordId) });
      },
    },
    {
      method: "get",
      path: "/quality/records/:id/nc",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ nc: await ncOfRecord(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/quality/ncs/export",
      guards: [
        sensitiveRateLimit(deps, { name: "quality-csv", windowMs: HOUR, limit: 30, key: byUser }),
      ],
      handler: async (req, res) => {
        const file = await exportNcsCsv(adminContextOf(req), NcFiltersSchema.parse(req.query));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="no-conformidades.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.body);
      },
    },
    {
      method: "get",
      path: "/quality/ncs/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ nc: await getNc(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/ncs/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ nc: await updateNc(adminContextOf(req), id, UpdateNcSchema.parse(req.body)) });
      },
    },
    {
      method: "post",
      path: "/quality/ncs/:id/cancel",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { reason } = ReasonSchema.parse(req.body);
        res.json({ nc: await cancelNc(adminContextOf(req), id, reason) });
      },
    },
    {
      method: "post",
      path: "/quality/ncs/:id/reopen",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { reason } = ReasonSchema.parse(req.body);
        res.json({ nc: await reopenNc(adminContextOf(req), id, reason) });
      },
    },
    {
      method: "get",
      path: "/quality/ncs/:id/events",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ items: await ncEvents(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/ncs/:id/folder",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ folder: await ncFolder(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/ncs/:id/actions",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const nc = await addAction(adminContextOf(req), id, ActionSchema.parse(req.body));
        res.status(201).json({ nc });
      },
    },
    {
      method: "put",
      path: "/quality/ncs/:id/verify-on",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { date } = VerifyOnSchema.parse(req.body);
        res.json({ nc: await setVerifyOn(adminContextOf(req), id, date) });
      },
    },
    {
      method: "post",
      path: "/quality/ncs/:id/verifications",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          nc: await verifyNc(adminContextOf(req), id, VerificationSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/forms/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ settings: await getFormQuality(adminContextOf(req), id) });
      },
    },
    {
      method: "put",
      path: "/quality/forms/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          settings: await saveFormQuality(
            adminContextOf(req),
            id,
            FormQualitySchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "get",
      path: "/quality/actions",
      handler: async (req, res) => {
        res.json(
          await listQualityActions(adminContextOf(req), ListActionsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "patch",
      path: "/quality/actions/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          nc: await updateQualityAction(
            adminContextOf(req),
            id,
            UpdateActionSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/actions/:id/done",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { note } = CompleteActionSchema.parse(req.body);
        res.json({ action: await completeQualityAction(adminContextOf(req), id, note ?? null) });
      },
    },
    // Phase 2: the HACCP plan, its critical control points and product on hold.
    {
      method: "post",
      path: "/admin/quality/template",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json(await loadTemplate(adminContextOf(req)));
      },
    },
    {
      method: "get",
      path: "/quality/haccp",
      handler: async (req, res) => {
        const { archived } = HaccpQuerySchema.parse(req.query);
        res.json(await haccpOverview(adminContextOf(req), archived === "1"));
      },
    },
    {
      method: "get",
      path: "/quality/ccps/form-options",
      handler: async (req, res) => {
        const { q } = FormOptionsQuery.parse(req.query);
        res.json({ items: await ccpFormOptions(adminContextOf(req), q) });
      },
    },
    {
      method: "post",
      path: "/quality/ccps",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ ccp: await createCcp(adminContextOf(req), CcpSchema.parse(req.body)) });
      },
    },
    {
      method: "put",
      path: "/quality/ccps/order",
      handler: async (req, res) => {
        await orderCcps(adminContextOf(req), OrderSchema.parse(req.body).ids);
        res.status(204).end();
      },
    },
    {
      method: "patch",
      path: "/quality/ccps/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          ccp: await updateCcp(adminContextOf(req), id, UpdateCcpSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/ccps/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { archived } = ArchiveSchema.parse(req.body);
        res.json({ ccp: await setCcpArchived(adminContextOf(req), id, archived) });
      },
    },
    {
      method: "get",
      path: "/quality/holds",
      handler: async (req, res) => {
        res.json(await listHolds(adminContextOf(req), ListHoldsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/quality/holds",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ hold: await createHold(adminContextOf(req), HoldSchema.parse(req.body)) });
      },
    },
    {
      method: "get",
      path: "/quality/holds/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ hold: await getHold(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/holds/:id/decision",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          hold: await decideHold(adminContextOf(req), id, DecisionSchema.parse(req.body)),
        });
      },
    },
    // Phase 3: audits and their findings.
    {
      method: "get",
      path: "/quality/audits",
      handler: async (req, res) => {
        res.json({
          items: await listAudits(adminContextOf(req), AuditsQuerySchema.parse(req.query)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/audits/coverage",
      handler: async (req, res) => {
        const { year } = CoverageQuerySchema.parse(req.query);
        res.json({ standards: await auditCoverage(adminContextOf(req), year) });
      },
    },
    {
      method: "post",
      path: "/quality/audits",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ audit: await createAudit(adminContextOf(req), AuditSchema.parse(req.body)) });
      },
    },
    {
      method: "get",
      path: "/quality/audits/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ audit: await getAudit(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/audits/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          audit: await updateAudit(adminContextOf(req), id, UpdateAuditSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/audits/:id/done",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ audit: await closeAudit(adminContextOf(req), id, DoneSchema.parse(req.body)) });
      },
    },
    {
      method: "post",
      path: "/quality/audits/:id/cancel",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { reason } = ReasonSchema.parse(req.body);
        res.json({ audit: await cancelAudit(adminContextOf(req), id, reason) });
      },
    },
    {
      method: "post",
      path: "/quality/audits/:id/findings",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.status(201).json({
          audit: await addFinding(adminContextOf(req), id, FindingSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/findings/:id/nc",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { ownerId } = FindingNcSchema.parse(req.body);
        res.json({ audit: await findingNc(adminContextOf(req), id, ownerId) });
      },
    },
  ];
}
