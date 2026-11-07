// The food quality module (docs/spec/calidad.md): /admin/quality turns it on or off (only the owner);
// /quality/* is the module itself. Every service checks the module is on and who sees what.
import type { Request } from "express";
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { qualityDashboard } from "./dashboard.service.ts";
import {
  addPrpCheck,
  createPrp,
  listPrps,
  prpChecks,
  setPrpArchived,
  updatePrp,
} from "./prps.service.ts";
import { PrpCheckSchema, PrpSchema, PrpsQuerySchema, UpdatePrpSchema } from "./prps.schemas.ts";
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
  AnswerSchema,
  ComplaintNcSchema,
  ComplaintSchema,
  ComplaintsQuerySchema,
  CrisisContactSchema,
  CrisisMemberSchema,
  RecallTestSchema,
  UnitsSchema,
  UpdateComplaintSchema,
  UpdateCrisisContactSchema,
  YearQuerySchema,
} from "./complaints.schemas.ts";
import {
  answerComplaint,
  closeComplaint,
  complaintIndicators,
  complaintNc,
  createComplaint,
  getComplaint,
  listComplaints,
  setMonthUnits,
  updateComplaint,
} from "./complaints.service.ts";
import {
  addCrisisContact,
  addCrisisMember,
  addRecallTest,
  archiveCrisisContact,
  getCrisis,
  removeCrisisMember,
  updateCrisisContact,
} from "./crisis.service.ts";
import {
  ReviewSchema,
  SupplierDocSchema,
  SupplierSchema,
  SuppliersQuerySchema,
  UpdateSupplierSchema,
} from "./suppliers.schemas.ts";
import {
  addSupplierDoc,
  archiveSupplierDoc,
  createSupplier,
  getSupplier,
  listSuppliers,
  reviewSupplier,
  setSupplierArchived,
  supplierFiles,
  supplierFolder,
  updateSupplier,
} from "./suppliers.service.ts";
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
    // Phase 4: suppliers, their documents and reviews.
    {
      method: "get",
      path: "/quality/suppliers",
      handler: async (req, res) => {
        res.json(await listSuppliers(adminContextOf(req), SuppliersQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/quality/suppliers",
      handler: async (req, res) => {
        res.status(201).json({
          supplier: await createSupplier(adminContextOf(req), SupplierSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/suppliers/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ supplier: await getSupplier(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/suppliers/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          supplier: await updateSupplier(
            adminContextOf(req),
            id,
            UpdateSupplierSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/suppliers/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { archived } = ArchiveSchema.parse(req.body);
        res.json({ supplier: await setSupplierArchived(adminContextOf(req), id, archived) });
      },
    },
    {
      method: "post",
      path: "/quality/suppliers/:id/folder",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ folder: await supplierFolder(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/quality/suppliers/:id/files",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ items: await supplierFiles(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/suppliers/:id/docs",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.status(201).json({
          supplier: await addSupplierDoc(
            adminContextOf(req),
            id,
            SupplierDocSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/supplier-docs/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ supplier: await archiveSupplierDoc(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/suppliers/:id/reviews",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.status(201).json({
          supplier: await reviewSupplier(adminContextOf(req), id, ReviewSchema.parse(req.body)),
        });
      },
    },
    // Phase 5: complaints, units sold, the crisis team and recall tests.
    {
      method: "get",
      path: "/quality/complaints",
      handler: async (req, res) => {
        res.json(await listComplaints(adminContextOf(req), ComplaintsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/quality/complaints",
      handler: async (req, res) => {
        res.status(201).json({
          complaint: await createComplaint(adminContextOf(req), ComplaintSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/complaints/indicators",
      handler: async (req, res) => {
        const { year } = YearQuerySchema.parse(req.query);
        res.json(await complaintIndicators(adminContextOf(req), year));
      },
    },
    {
      method: "put",
      path: "/quality/units",
      handler: async (req, res) => {
        await setMonthUnits(adminContextOf(req), UnitsSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/quality/complaints/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ complaint: await getComplaint(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/complaints/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          complaint: await updateComplaint(
            adminContextOf(req),
            id,
            UpdateComplaintSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/complaints/:id/answer",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          complaint: await answerComplaint(adminContextOf(req), id, AnswerSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/complaints/:id/close",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ complaint: await closeComplaint(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/complaints/:id/nc",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          complaint: await complaintNc(adminContextOf(req), id, ComplaintNcSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/crisis",
      handler: async (req, res) => {
        res.json({ crisis: await getCrisis(adminContextOf(req)) });
      },
    },
    {
      method: "post",
      path: "/quality/crisis/members",
      handler: async (req, res) => {
        res.status(201).json({
          crisis: await addCrisisMember(adminContextOf(req), CrisisMemberSchema.parse(req.body)),
        });
      },
    },
    {
      method: "delete",
      path: "/quality/crisis/members/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ crisis: await removeCrisisMember(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/crisis/contacts",
      handler: async (req, res) => {
        res.status(201).json({
          crisis: await addCrisisContact(adminContextOf(req), CrisisContactSchema.parse(req.body)),
        });
      },
    },
    {
      method: "patch",
      path: "/quality/crisis/contacts/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          crisis: await updateCrisisContact(
            adminContextOf(req),
            id,
            UpdateCrisisContactSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/crisis/contacts/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ crisis: await archiveCrisisContact(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/recall-tests",
      handler: async (req, res) => {
        res.status(201).json({
          crisis: await addRecallTest(adminContextOf(req), RecallTestSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/dashboard",
      handler: async (req, res) => {
        res.json(await qualityDashboard(adminContextOf(req)));
      },
    },
    {
      method: "get",
      path: "/quality/prps",
      handler: async (req, res) => {
        res.json({ prps: await listPrps(adminContextOf(req), PrpsQuerySchema.parse(req.query)) });
      },
    },
    {
      method: "post",
      path: "/quality/prps",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ prp: await createPrp(adminContextOf(req), PrpSchema.parse(req.body)) });
      },
    },
    {
      method: "patch",
      path: "/quality/prps/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          prp: await updatePrp(adminContextOf(req), id, UpdatePrpSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/prps/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ prp: await setPrpArchived(adminContextOf(req), id, true) });
      },
    },
    {
      method: "post",
      path: "/quality/prps/:id/restore",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ prp: await setPrpArchived(adminContextOf(req), id, false) });
      },
    },
    {
      method: "get",
      path: "/quality/prps/:id/checks",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ checks: await prpChecks(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/prps/:id/checks",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res
          .status(201)
          .json({
            prp: await addPrpCheck(adminContextOf(req), id, PrpCheckSchema.parse(req.body)),
          });
      },
    },
  ];
}
