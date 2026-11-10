// The food quality module (docs/spec/calidad.md): /admin/quality turns it on or off (only the owner);
// /quality/* is the module itself. Every service checks the module is on and who sees what.
import type { Request } from "express";
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { qualityDashboard } from "./dashboard.service.ts";
import {
  addStudy,
  createProduct,
  getProduct,
  listProducts,
  productFiles,
  productFolder,
  reviewLabel,
  setProductArchived,
  studyResult,
  submitLabel,
  updateProduct,
} from "./products.service.ts";
import {
  LabelReviewSchema,
  LabelSchema,
  LabResultSchema,
  ProductSchema,
  ProductsQuerySchema,
  SamplingPointSchema,
  SamplingQuerySchema,
  StudyResultSchema,
  StudySchema,
  UpdateProductSchema,
  UpdateSamplingPointSchema,
} from "./products.schemas.ts";
import {
  addLabResult,
  createSamplingPoint,
  listSamplingPoints,
  samplingFiles,
  samplingFolder,
  samplingResults,
  setSamplingArchived,
  updateSamplingPoint,
} from "./sampling.service.ts";
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
  askMaintenance,
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
import {
  addInput,
  addShipment,
  createLot,
  deleteLot,
  exportTrace,
  getLot,
  listLots,
  removeLink,
  removeShipment,
  traceLot,
  updateLot,
} from "./lots.service.ts";
import { importTemplate, importTrace } from "./lots-import.ts";
import {
  ImportSchema,
  LinkSchema,
  LotSchema,
  LotsQuerySchema,
  ShipmentSchema,
  TemplateParams,
  TraceExportParams,
  TraceQuerySchema,
  UpdateLotSchema,
} from "./lots.schemas.ts";
import {
  archiveCultureActivity,
  answerSurvey,
  closeSurvey,
  createCultureActivity,
  createSurvey,
  cultureOverview,
  getSurvey,
  pendingSurveys,
  saveCulturePlan,
  setCultureActivityDone,
  surveyResults,
  surveyToAnswer,
  updateCultureActivity,
  updateSurvey,
} from "./culture.service.ts";
import {
  cancelChange,
  decideChange,
  getChange,
  implementChange,
  listChanges,
  proposeChange,
  updateChange,
} from "./changes.service.ts";
import {
  ChangeDecisionSchema,
  ChangeImplementedSchema,
  ChangeSchema,
  ChangesQuerySchema,
  CultureActivitySchema,
  CultureDoneSchema,
  CulturePlanSchema,
  CultureYearQuerySchema,
  SurveyAnswerSchema,
  SurveySchema,
  UpdateChangeSchema,
  UpdateCultureActivitySchema,
  UpdateSurveySchema,
} from "./culture.schemas.ts";

const IdParams = z.object({ id: z.string().min(1).max(64) });
const YearParams = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
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
      // «Ask maintenance» (docs/spec/mantenimiento.md, section 8): its work order, with the equipment.
      method: "post",
      path: "/quality/ncs/:id/maintenance",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { assetId } = z
          .strictObject({ assetId: z.string().min(1).max(64).nullable().default(null) })
          .parse(req.body);
        res.json({ nc: await askMaintenance(adminContextOf(req), id, assetId) });
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
        res.status(201).json({
          prp: await addPrpCheck(adminContextOf(req), id, PrpCheckSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/products",
      handler: async (req, res) => {
        res.json(await listProducts(adminContextOf(req), ProductsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/quality/products",
      handler: async (req, res) => {
        res.status(201).json({
          product: await createProduct(adminContextOf(req), ProductSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/products/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ product: await getProduct(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/products/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          product: await updateProduct(
            adminContextOf(req),
            id,
            UpdateProductSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/products/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { archived } = ArchiveSchema.parse(req.body);
        res.json({ product: await setProductArchived(adminContextOf(req), id, archived) });
      },
    },
    {
      method: "post",
      path: "/quality/products/:id/folder",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ folder: await productFolder(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/quality/products/:id/files",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ items: await productFiles(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/products/:id/studies",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res
          .status(201)
          .json({ product: await addStudy(adminContextOf(req), id, StudySchema.parse(req.body)) });
      },
    },
    {
      method: "post",
      path: "/quality/studies/:id/result",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          product: await studyResult(adminContextOf(req), id, StudyResultSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/products/:id/labels",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.status(201).json({
          product: await submitLabel(adminContextOf(req), id, LabelSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/labels/:id/review",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          product: await reviewLabel(adminContextOf(req), id, LabelReviewSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/sampling",
      handler: async (req, res) => {
        res.json({
          items: await listSamplingPoints(
            adminContextOf(req),
            SamplingQuerySchema.parse(req.query),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/sampling",
      handler: async (req, res) => {
        res.status(201).json({
          point: await createSamplingPoint(
            adminContextOf(req),
            SamplingPointSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "patch",
      path: "/quality/sampling/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          point: await updateSamplingPoint(
            adminContextOf(req),
            id,
            UpdateSamplingPointSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/sampling/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ point: await setSamplingArchived(adminContextOf(req), id, true) });
      },
    },
    {
      method: "post",
      path: "/quality/sampling/:id/restore",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ point: await setSamplingArchived(adminContextOf(req), id, false) });
      },
    },
    {
      method: "post",
      path: "/quality/sampling/:id/folder",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ folder: await samplingFolder(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/quality/sampling/:id/files",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ items: await samplingFiles(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/quality/sampling/:id/results",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ results: await samplingResults(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/sampling/:id/results",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.status(201).json({
          point: await addLabResult(adminContextOf(req), id, LabResultSchema.parse(req.body)),
        });
      },
    },
    // ─── Phase 6c: food safety culture ───
    {
      method: "get",
      path: "/quality/culture",
      handler: async (req, res) => {
        res.json(await cultureOverview(adminContextOf(req), CultureYearQuerySchema.parse(req.query)));
      },
    },
    {
      method: "put",
      path: "/quality/culture/plans/:year",
      handler: async (req, res) => {
        const { year } = YearParams.parse(req.params);
        res.json({
          plan: await saveCulturePlan(adminContextOf(req), year, CulturePlanSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/culture/activities",
      handler: async (req, res) => {
        res.status(201).json({
          activity: await createCultureActivity(
            adminContextOf(req),
            CultureActivitySchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "patch",
      path: "/quality/culture/activities/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          activity: await updateCultureActivity(
            adminContextOf(req),
            id,
            UpdateCultureActivitySchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/quality/culture/activities/:id/done",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { doneOn } = CultureDoneSchema.parse(req.body);
        res.json({ activity: await setCultureActivityDone(adminContextOf(req), id, doneOn) });
      },
    },
    {
      method: "post",
      path: "/quality/culture/activities/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json(await archiveCultureActivity(adminContextOf(req), id));
      },
    },
    {
      method: "get",
      path: "/quality/culture/surveys/pending",
      handler: async (req, res) => {
        res.json({ items: await pendingSurveys(adminContextOf(req)) });
      },
    },
    {
      method: "post",
      path: "/quality/culture/surveys",
      handler: async (req, res) => {
        res.status(201).json({
          survey: await createSurvey(adminContextOf(req), SurveySchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/culture/surveys/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ survey: await getSurvey(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/culture/surveys/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          survey: await updateSurvey(adminContextOf(req), id, UpdateSurveySchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/culture/surveys/:id/close",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ survey: await closeSurvey(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/quality/culture/surveys/:id/results",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json(await surveyResults(adminContextOf(req), id));
      },
    },
    {
      method: "get",
      path: "/quality/culture/surveys/:id/answer",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ survey: await surveyToAnswer(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/quality/culture/surveys/:id/answer",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res
          .status(201)
          .json(await answerSurvey(adminContextOf(req), id, SurveyAnswerSchema.parse(req.body)));
      },
    },
    // ─── Phase 6c: change management ───
    {
      method: "get",
      path: "/quality/changes",
      handler: async (req, res) => {
        res.json(await listChanges(adminContextOf(req), ChangesQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/quality/changes",
      handler: async (req, res) => {
        res.status(201).json({
          change: await proposeChange(adminContextOf(req), ChangeSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/quality/changes/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ change: await getChange(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/changes/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          change: await updateChange(adminContextOf(req), id, UpdateChangeSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/changes/:id/decision",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          change: await decideChange(adminContextOf(req), id, ChangeDecisionSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/quality/changes/:id/implemented",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { implementedOn } = ChangeImplementedSchema.parse(req.body);
        res.json({ change: await implementChange(adminContextOf(req), id, implementedOn) });
      },
    },
    {
      method: "post",
      path: "/quality/changes/:id/cancel",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ change: await cancelChange(adminContextOf(req), id) });
      },
    },
    // ─── Phase 7: traceability ───
    {
      method: "get",
      path: "/quality/lots",
      handler: async (req, res) => {
        res.json(await listLots(adminContextOf(req), LotsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/quality/lots",
      handler: async (req, res) => {
        res.status(201).json({ lot: await createLot(adminContextOf(req), LotSchema.parse(req.body)) });
      },
    },
    {
      method: "get",
      path: "/quality/lots/template/:kind",
      handler: async (req, res) => {
        const { kind } = TemplateParams.parse(req.params);
        const file = await importTemplate(adminContextOf(req), kind);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${kind}.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.body);
      },
    },
    {
      method: "post",
      path: "/quality/lots/import",
      guards: [
        sensitiveRateLimit(deps, { name: "quality-trace-import", windowMs: HOUR, limit: 60, key: byUser }),
      ],
      handler: async (req, res) => {
        res.json(await importTrace(adminContextOf(req), ImportSchema.parse(req.body)));
      },
    },
    {
      method: "get",
      path: "/quality/lots/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ lot: await getLot(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/quality/lots/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ lot: await updateLot(adminContextOf(req), id, UpdateLotSchema.parse(req.body)) });
      },
    },
    {
      method: "delete",
      path: "/quality/lots/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json(await deleteLot(adminContextOf(req), id));
      },
    },
    {
      method: "post",
      path: "/quality/lots/:id/inputs",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res
          .status(201)
          .json({ lot: await addInput(adminContextOf(req), id, LinkSchema.parse(req.body)) });
      },
    },
    {
      method: "delete",
      path: "/quality/lot-links/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json(await removeLink(adminContextOf(req), id));
      },
    },
    {
      method: "post",
      path: "/quality/lots/:id/shipments",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res
          .status(201)
          .json({ lot: await addShipment(adminContextOf(req), id, ShipmentSchema.parse(req.body)) });
      },
    },
    {
      method: "delete",
      path: "/quality/shipments/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json(await removeShipment(adminContextOf(req), id));
      },
    },
    {
      method: "get",
      path: "/quality/lots/:id/trace",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { direction } = TraceQuerySchema.parse(req.query);
        res.json(await traceLot(adminContextOf(req), id, direction));
      },
    },
    {
      method: "get",
      path: "/quality/lots/:id/trace/export/:format",
      guards: [
        sensitiveRateLimit(deps, { name: "quality-trace-export", windowMs: HOUR, limit: 60, key: byUser }),
      ],
      handler: async (req, res) => {
        const { id, format } = TraceExportParams.parse(req.params);
        const { direction } = TraceQuerySchema.parse(req.query);
        const file = await exportTrace(
          adminContextOf(req),
          { gotenbergUrl: deps.env.GOTENBERG_URL },
          id,
          direction,
          format,
        );
        res.setHeader("Content-Type", file.contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="trazabilidad.${format}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(typeof file.body === "string" ? file.body : Buffer.from(file.body));
      },
    },
  ];
}
