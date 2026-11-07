// CAE, coordination of business activities (docs/spec/cae.md, «API»): /cae/* answers 404 while CAE or
// the module is off. The services check who sees and changes what (cae.manage, cae.check and the
// internal responsible person of each company).
import type { Request, Response } from "express";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import {
  checkWorker,
  listAccesses,
  recordAccess,
  searchGate,
  workerQr,
} from "./cae-gate.service.ts";
import { authorizedTodayPdf } from "./cae-pdf.ts";
import {
  getPortalAccess,
  issuePortalAccess,
  revokePortalAccess,
} from "./cae-portal-access.service.ts";
import {
  companyInfo,
  createInfoDelivery,
  getInfoSettings,
  infoDeliveryPdf,
  infoOptions,
  listInfoDeliveries,
  updateInfoSettings,
} from "./cae-info.service.ts";
import {
  approvePermit,
  cancelPermit,
  closePermit,
  createPermit,
  getPermit,
  listPermits,
  permitPdf,
  updatePermit,
} from "./cae-permits.service.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  acceptDocument,
  companyUploadTarget,
  createDocument,
  listDocuments,
  rejectDocument,
  workerUploadTarget,
} from "./cae-documents.service.ts";
import {
  AcceptDocumentSchema,
  ApprovePermitSchema,
  CancelPermitSchema,
  ClosePermitSchema,
  CreateInfoDeliverySchema,
  CreatePermitSchema,
  InfoOptionsQuerySchema,
  ListInfoDeliveriesQuerySchema,
  ListPermitsQuerySchema,
  UpdateInfoSchema,
  UpdatePermitSchema,
  AccessSchema,
  IssuePortalSchema,
  CheckQuerySchema,
  ListAccessesQuerySchema,
  CreateDocumentSchema,
  ListDocumentsQuerySchema,
  RejectDocumentSchema,
  BlockSchema,
  CreateCompanySchema,
  CreateRequirementSchema,
  CreateWorkerSchema,
  IdParamsSchema,
  ListCompaniesQuerySchema,
  ListRequirementsQuerySchema,
  ListWorkersQuerySchema,
  OrderRequirementsSchema,
  UpdateCompanySchema,
  UpdateRequirementSchema,
  UpdateWorkerSchema,
} from "./cae.schemas.ts";
import {
  archiveCompany,
  archiveWorker,
  blockCompany,
  blockWorker,
  createCompany,
  createWorker,
  getCompany,
  getWorker,
  listCompanies,
  listCompanyWorkers,
  listWorkers,
  unblockCompany,
  unblockWorker,
  updateCompany,
  updateWorker,
} from "./cae.service.ts";
import {
  archiveRequirement,
  createRequirement,
  listRequirements,
  orderRequirements,
  updateRequirement,
} from "./cae-requirements.service.ts";

const HOUR = 3_600_000;

export function caeRoutes(deps: Pick<AppDeps, "prisma" | "env">): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  const pdfLimit = sensitiveRateLimit(deps, {
    name: "cae-pdf",
    windowMs: HOUR,
    limit: 60,
    key: byUser,
  });
  const sendPdf = (res: Response, file: { fileName: string; body: Uint8Array }) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="cae.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(file.body));
  };
  const gotenberg = { gotenbergUrl: deps.env.GOTENBERG_URL };
  return [
    // The contractor's portal (a link with a code): issue, see and revoke it (cae.manage).
    {
      method: "get",
      path: "/cae/companies/:id/portal",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ access: await getPortalAccess(adminContextOf(req), deps.env.APP_URL, id) });
      },
    },
    {
      method: "post",
      path: "/cae/companies/:id/portal",
      guards: [
        sensitiveRateLimit(deps, {
          name: "cae-portal-issue",
          windowMs: HOUR,
          limit: 30,
          key: byUser,
        }),
      ],
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const input = IssuePortalSchema.parse(req.body);
        const issued = await issuePortalAccess(adminContextOf(req), deps.env.APP_URL, id, input);
        // The code goes once, in this answer only.
        res.setHeader("Cache-Control", "no-store");
        res.status(201).json(issued);
      },
    },
    {
      method: "post",
      path: "/cae/companies/:id/portal/revoke",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        await revokePortalAccess(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    // The site's information for contractors (RD 171/2004, arts. 7 to 9).
    {
      method: "get",
      path: "/cae/info",
      handler: async (req, res) => {
        res.json({ info: await getInfoSettings(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/cae/info",
      handler: async (req, res) => {
        const info = await updateInfoSettings(
          adminContextOf(req),
          UpdateInfoSchema.parse(req.body),
        );
        res.json({ info });
      },
    },
    {
      method: "get",
      path: "/cae/info/options",
      handler: async (req, res) => {
        res.json(await infoOptions(adminContextOf(req), InfoOptionsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/cae/companies/:id/info",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ info: await companyInfo(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/cae/companies/:id/info/deliveries",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json(
          await listInfoDeliveries(
            adminContextOf(req),
            id,
            ListInfoDeliveriesQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "post",
      path: "/cae/companies/:id/info/deliveries",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const delivery = await createInfoDelivery(
          adminContextOf(req),
          id,
          CreateInfoDeliverySchema.parse(req.body),
        );
        res.status(201).json({ delivery });
      },
    },
    {
      method: "get",
      path: "/cae/info/deliveries/:id/pdf",
      guards: [pdfLimit],
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        sendPdf(res, await infoDeliveryPdf(adminContextOf(req), gotenberg, id));
      },
    },
    // Work permits (contractors' workers and own staff).
    {
      method: "get",
      path: "/cae/permits",
      handler: async (req, res) => {
        res.json(await listPermits(adminContextOf(req), ListPermitsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/cae/permits",
      handler: async (req, res) => {
        const permit = await createPermit(adminContextOf(req), CreatePermitSchema.parse(req.body));
        res.status(201).json({ permit });
      },
    },
    {
      method: "get",
      path: "/cae/permits/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ permit: await getPermit(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/cae/permits/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const changes = UpdatePermitSchema.parse(req.body);
        res.json({ permit: await updatePermit(adminContextOf(req), id, changes) });
      },
    },
    {
      method: "post",
      path: "/cae/permits/:id/approve",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const input = ApprovePermitSchema.parse(req.body);
        res.json({ permit: await approvePermit(adminContextOf(req), id, input) });
      },
    },
    {
      method: "post",
      path: "/cae/permits/:id/close",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const { note } = ClosePermitSchema.parse(req.body ?? {});
        res.json({ permit: await closePermit(adminContextOf(req), id, note) });
      },
    },
    {
      method: "post",
      path: "/cae/permits/:id/cancel",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const { reason } = CancelPermitSchema.parse(req.body);
        res.json({ permit: await cancelPermit(adminContextOf(req), id, reason) });
      },
    },
    {
      method: "get",
      path: "/cae/permits/:id/pdf",
      guards: [pdfLimit],
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        sendPdf(res, await permitPdf(adminContextOf(req), gotenberg, id));
      },
    },
    // The gatehouse (cae.check): search, one worker, entries and exits.
    {
      method: "get",
      path: "/cae/check",
      handler: async (req, res) => {
        res.json(await searchGate(adminContextOf(req), CheckQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/cae/check/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ result: await checkWorker(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/cae/access",
      handler: async (req, res) => {
        const result = await recordAccess(adminContextOf(req), AccessSchema.parse(req.body));
        res.status(201).json({ result });
      },
    },
    {
      method: "get",
      path: "/cae/access",
      handler: async (req, res) => {
        res.json(await listAccesses(adminContextOf(req), ListAccessesQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/cae/workers/:id/qr",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json(await workerQr(adminContextOf(req), deps.env.APP_URL, id));
      },
    },
    {
      method: "get",
      path: "/cae/companies/:id/pdf",
      guards: [
        sensitiveRateLimit(deps, { name: "cae-pdf", windowMs: HOUR, limit: 60, key: byUser }),
      ],
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const file = await authorizedTodayPdf(
          adminContextOf(req),
          { gotenbergUrl: deps.env.GOTENBERG_URL },
          id,
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="autorizados.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(Buffer.from(file.body));
      },
    },
    // Companies.
    {
      method: "get",
      path: "/cae/companies",
      handler: async (req, res) => {
        res.json(
          await listCompanies(adminContextOf(req), ListCompaniesQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/cae/companies",
      handler: async (req, res) => {
        const company = await createCompany(
          adminContextOf(req),
          CreateCompanySchema.parse(req.body),
        );
        res.status(201).json({ company });
      },
    },
    {
      method: "get",
      path: "/cae/companies/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ company: await getCompany(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/cae/companies/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const changes = UpdateCompanySchema.parse(req.body);
        res.json({ company: await updateCompany(adminContextOf(req), id, changes) });
      },
    },
    {
      method: "post",
      path: "/cae/companies/:id/block",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const { reason } = BlockSchema.parse(req.body);
        res.json({ company: await blockCompany(adminContextOf(req), id, reason) });
      },
    },
    {
      method: "post",
      path: "/cae/companies/:id/unblock",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ company: await unblockCompany(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/cae/companies/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ company: await archiveCompany(adminContextOf(req), id) });
      },
    },
    // Workers.
    {
      method: "get",
      path: "/cae/companies/:id/workers",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json(
          await listCompanyWorkers(
            adminContextOf(req),
            id,
            ListWorkersQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "post",
      path: "/cae/companies/:id/workers",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const worker = await createWorker(
          adminContextOf(req),
          id,
          CreateWorkerSchema.parse(req.body),
        );
        res.status(201).json({ worker });
      },
    },
    {
      method: "get",
      path: "/cae/workers",
      handler: async (req, res) => {
        res.json(await listWorkers(adminContextOf(req), ListWorkersQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/cae/workers/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ worker: await getWorker(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/cae/workers/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const changes = UpdateWorkerSchema.parse(req.body);
        res.json({ worker: await updateWorker(adminContextOf(req), id, changes) });
      },
    },
    {
      method: "post",
      path: "/cae/workers/:id/block",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const { reason } = BlockSchema.parse(req.body);
        res.json({ worker: await blockWorker(adminContextOf(req), id, reason) });
      },
    },
    {
      method: "post",
      path: "/cae/workers/:id/unblock",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ worker: await unblockWorker(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/cae/workers/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ worker: await archiveWorker(adminContextOf(req), id) });
      },
    },
    // Documents: the file goes first to the company's folder (or its worker's) with the normal upload.
    {
      method: "post",
      path: "/cae/companies/:id/folder",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ target: await companyUploadTarget(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/cae/workers/:id/folder",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ target: await workerUploadTarget(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/cae/documents",
      handler: async (req, res) => {
        res.json(
          await listDocuments(adminContextOf(req), ListDocumentsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/cae/documents",
      handler: async (req, res) => {
        const document = await createDocument(
          adminContextOf(req),
          CreateDocumentSchema.parse(req.body),
        );
        res.status(201).json({ document });
      },
    },
    {
      method: "post",
      path: "/cae/documents/:id/accept",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const input = AcceptDocumentSchema.parse(req.body ?? {});
        res.json({ document: await acceptDocument(adminContextOf(req), id, input) });
      },
    },
    {
      method: "post",
      path: "/cae/documents/:id/reject",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const { reason } = RejectDocumentSchema.parse(req.body);
        res.json({ document: await rejectDocument(adminContextOf(req), id, reason) });
      },
    },
    // Catalog of required documents.
    {
      method: "get",
      path: "/cae/requirements",
      handler: async (req, res) => {
        res.json(
          await listRequirements(adminContextOf(req), ListRequirementsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/cae/requirements",
      handler: async (req, res) => {
        const requirement = await createRequirement(
          adminContextOf(req),
          CreateRequirementSchema.parse(req.body),
        );
        res.status(201).json({ requirement });
      },
    },
    // Before /:id, so «order» isn't taken for an id.
    {
      method: "put",
      path: "/cae/requirements/order",
      handler: async (req, res) => {
        const items = await orderRequirements(
          adminContextOf(req),
          OrderRequirementsSchema.parse(req.body),
        );
        res.json({ items });
      },
    },
    {
      method: "patch",
      path: "/cae/requirements/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const changes = UpdateRequirementSchema.parse(req.body);
        res.json({ requirement: await updateRequirement(adminContextOf(req), id, changes) });
      },
    },
    {
      method: "post",
      path: "/cae/requirements/:id/archive",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ requirement: await archiveRequirement(adminContextOf(req), id) });
      },
    },
  ];
}
