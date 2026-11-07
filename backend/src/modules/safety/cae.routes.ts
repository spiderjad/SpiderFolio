// CAE, coordination of business activities (docs/spec/cae.md, «API»): /cae/* answers 404 while CAE or
// the module is off. The services check who sees and changes what (cae.manage, cae.check and the
// internal responsible person of each company).
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
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

export function caeRoutes(): TenantRoute[] {
  return [
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
