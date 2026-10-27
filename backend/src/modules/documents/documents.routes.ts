// /nodes/:id/controlled y /document-types. El acceso lo decide resolveAccess en el servicio.
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { sharingDepsOf } from "../access/sharing.service.ts";
import {
  AccessGapsQuerySchema,
  PublishSchema,
  ApproversQuerySchema,
  GrantReadingAccessSchema,
  RemindSchema,
  OwnerDepartmentSchema,
  CompareQuerySchema,
  PdfQuerySchema,
  ConvertSchema,
  DecisionSchema,
  DocumentNodeParamsSchema,
  MyApprovalsQuerySchema,
  MyReadingsQuerySchema,
  NewsQuerySchema,
  RecentQuerySchema,
  ReadingsQuerySchema,
  RequirementParamsSchema,
  RequirementSchema,
  SubmitSchema,
} from "./documents.schemas.ts";
import {
  approverOptions,
  setOwnerDepartment,
  decide,
  myApprovals,
  publish,
  submitForReview,
  withdraw,
} from "./approvals.service.ts";
import {
  acknowledge,
  addRequirement,
  myReadings,
  grantReadingAccess,
  readingAccessGaps,
  readingsCsv,
  readingsOverview,
  remindReaders,
  removeRequirement,
} from "./readings.service.ts";
import { recentDocuments } from "./recent.service.ts";
import { documentNews } from "./news.service.ts";
import { downloadControlledPdf } from "./pdf.service.ts";
import { compareSinceReview, compareVersions } from "./compare.service.ts";
import { getControlled, listDocumentTypes, makeControlled } from "./documents.service.ts";

export function documentRoutes(deps: AppDeps): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/document-types",
      handler: async (req, res) => {
        res.json({ items: await listDocumentTypes(adminContextOf(req)) });
      },
    },
    {
      method: "get",
      path: "/nodes/:id/controlled",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        res.json(await getControlled(adminContextOf(req), id));
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        res
          .status(201)
          .json(
            await makeControlled(
              adminContextOf(req),
              id,
              ConvertSchema.parse(req.body),
            ),
          );
      },
    },
    {
      method: "patch",
      path: "/nodes/:id/controlled",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        const { ownerDepartmentId } = OwnerDepartmentSchema.parse(req.body);
        await setOwnerDepartment(adminContextOf(req), id, ownerDepartmentId);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/nodes/:id/controlled/approvers",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        const { q } = ApproversQuerySchema.parse(req.query);
        res.json(await approverOptions(adminContextOf(req), id, q));
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled/submit",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        await submitForReview(adminContextOf(req), deps, id, SubmitSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled/decision",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        await decide(adminContextOf(req), deps, id, DecisionSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled/withdraw",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        await withdraw(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled/publish",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        await publish(adminContextOf(req), deps, id, PublishSchema.parse(req.body ?? {}));
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/nodes/:id/controlled/compare",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        const query = CompareQuerySchema.parse(req.query);
        res.json(
          query.since === "review"
            ? await compareSinceReview(adminContextOf(req), id)
            : await compareVersions(adminContextOf(req), id, query),
        );
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled/acknowledge",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        await acknowledge(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      // Antes de /readings/:requirementId para que "export" no se lea como un id.
      method: "get",
      path: "/nodes/:id/controlled/readings/export",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        const file = await readingsCsv(adminContextOf(req), id);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="lecturas.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.csv);
      },
    },
    {
      method: "get",
      path: "/nodes/:id/controlled/readings/access-gaps",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        res.json(
          await readingAccessGaps(adminContextOf(req), id, AccessGapsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled/readings/grant-access",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        await grantReadingAccess(
          adminContextOf(req),
          sharingDepsOf(deps),
          id,
          GrantReadingAccessSchema.parse(req.body),
        );
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/nodes/:id/controlled/readings/remind",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        res.json(await remindReaders(adminContextOf(req), deps, id, RemindSchema.parse(req.body)));
      },
    },
    {
      method: "get",
      path: "/nodes/:id/controlled/readings",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        res.json(
          await readingsOverview(adminContextOf(req), id, ReadingsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "put",
      path: "/nodes/:id/controlled/readings",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        await addRequirement(adminContextOf(req), deps, id, RequirementSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "delete",
      path: "/nodes/:id/controlled/readings/:requirementId",
      handler: async (req, res) => {
        const { id, requirementId } = RequirementParamsSchema.parse(req.params);
        await removeRequirement(adminContextOf(req), id, requirementId);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/documents/readings",
      handler: async (req, res) => {
        res.json(await myReadings(adminContextOf(req), MyReadingsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/nodes/:id/controlled/pdf",
      handler: async (req, res) => {
        const { id } = DocumentNodeParamsSchema.parse(req.params);
        const { version } = PdfQuerySchema.parse(req.query);
        const file = await downloadControlledPdf(
          adminContextOf(req),
          { storage: deps.storage, gotenbergUrl: deps.env.GOTENBERG_URL },
          id,
          version,
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="documento.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(Buffer.from(file.bytes));
      },
    },
    {
      method: "get",
      path: "/documents/recent",
      handler: async (req, res) => {
        res.json(await recentDocuments(adminContextOf(req), RecentQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/documents/news",
      handler: async (req, res) => {
        res.json(await documentNews(adminContextOf(req), NewsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/documents/approvals",
      handler: async (req, res) => {
        res.json(await myApprovals(adminContextOf(req), MyApprovalsQuerySchema.parse(req.query)));
      },
    },
  ];
}
