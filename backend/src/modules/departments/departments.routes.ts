// /api/v1/w/:slug/admin/departments (CLAUDE.md, sección 9.4).
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  AddDepartmentMembersSchema,
  CreateDepartmentSchema,
  DepartmentMemberParamsSchema,
  DepartmentMembersQuerySchema,
  DepartmentOptionsQuerySchema,
  DepartmentParamsSchema,
  ListDepartmentsQuerySchema,
  MoveDepartmentMemberSchema,
  SetPositionSchema,
  UpdateDepartmentSchema,
} from "./departments.schemas.ts";
import { structureReview } from "./structure-review.ts";
import {
  addDepartmentMembers,
  leaderNeedsFullSeat,
  createDepartment,
  deleteDepartment,
  departmentAccess,
  getDepartment,
  listDepartmentMembers,
  listDepartmentOptions,
  listDepartments,
  moveDepartmentMember,
  removeDepartmentMember,
  setDepartmentPosition,
  updateDepartment,
} from "./departments.service.ts";

export function departmentRoutes(): TenantRoute[] {
  return [
    {
      // Revisión de la estructura: lo que conviene corregir (jefes, plazas, personas sueltas).
      method: "get",
      path: "/admin/structure-review",
      anyCapability: ["departments.manage", "members.manage"],
      handler: async (req, res) => {
        res.json(await structureReview(adminContextOf(req)));
      },
    },
    {
      method: "get",
      path: "/admin/departments",
      // También lo usan quienes invitan o gestionan miembros (para elegir departamentos).
      anyCapability: ["departments.manage", "members.view", "members.invite", "members.manage"],
      // La estructura la lee todo miembro con plaza completa (según "Los miembros ven").
      memberAccess: true,
      handler: async (req, res) => {
        res.json(
          await listDepartments(adminContextOf(req), ListDepartmentsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      // Antes de /:id para que "options" no se lea como un id.
      method: "get",
      path: "/admin/departments/options",
      anyCapability: ["departments.manage", "members.view", "members.invite", "members.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        res.json(
          await listDepartmentOptions(
            adminContextOf(req),
            DepartmentOptionsQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "post",
      path: "/admin/departments",
      capability: "departments.manage",
      handler: async (req, res) => {
        const department = await createDepartment(
          adminContextOf(req),
          CreateDepartmentSchema.parse(req.body),
        );
        res.status(201).json({ department });
      },
    },
    {
      method: "get",
      path: "/admin/departments/:id",
      anyCapability: ["departments.manage"],
      memberAccess: true,
      handler: async (req, res) => {
        const { id } = DepartmentParamsSchema.parse(req.params);
        res.json(await getDepartment(adminContextOf(req), id));
      },
    },
    {
      method: "get",
      path: "/admin/departments/:id/members",
      anyCapability: ["departments.manage", "members.view", "members.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        const { id } = DepartmentParamsSchema.parse(req.params);
        res.json(
          await listDepartmentMembers(
            adminContextOf(req),
            id,
            DepartmentMembersQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "post",
      path: "/admin/departments/:id/members/:membershipId/move",
      anyCapability: ["departments.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        const { id, membershipId } = DepartmentMemberParamsSchema.parse(req.params);
        const { toDepartmentId } = MoveDepartmentMemberSchema.parse(req.body);
        await moveDepartmentMember(adminContextOf(req), id, membershipId, toDepartmentId);
        res.status(204).end();
      },
    },
    {
      method: "patch",
      path: "/admin/departments/:id",
      capability: "departments.manage",
      handler: async (req, res) => {
        const { id } = DepartmentParamsSchema.parse(req.params);
        const ctx = adminContextOf(req);
        const input = UpdateDepartmentSchema.parse(req.body);
        const department = await updateDepartment(ctx, id, input);
        const needsFullSeat =
          typeof input.headId === "string" ? await leaderNeedsFullSeat(ctx, input.headId) : false;
        res.json({ department, needsFullSeat });
      },
    },
    {
      // Nombrar o relevar jefe/subjefe: el cargo da el alcance (no hace falta ningún rol).
      method: "put",
      path: "/admin/departments/:id/members/:membershipId/position",
      anyCapability: ["departments.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        const { id, membershipId } = DepartmentMemberParamsSchema.parse(req.params);
        const ctx = adminContextOf(req);
        const input = SetPositionSchema.parse(req.body);
        const department = await setDepartmentPosition(ctx, id, membershipId, input.position);
        const needsFullSeat =
          input.position !== "MEMBER" ? await leaderNeedsFullSeat(ctx, membershipId) : false;
        res.json({ department, needsFullSeat });
      },
    },
    {
      method: "delete",
      path: "/admin/departments/:id",
      capability: "departments.manage",
      handler: async (req, res) => {
        const { id } = DepartmentParamsSchema.parse(req.params);
        await deleteDepartment(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/admin/departments/:id/members",
      anyCapability: ["departments.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        const { id } = DepartmentParamsSchema.parse(req.params);
        const { membershipIds } = AddDepartmentMembersSchema.parse(req.body);
        res.json(await addDepartmentMembers(adminContextOf(req), id, membershipIds));
      },
    },
    {
      method: "delete",
      path: "/admin/departments/:id/members/:membershipId",
      anyCapability: ["departments.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        const { id, membershipId } = DepartmentMemberParamsSchema.parse(req.params);
        await removeDepartmentMember(adminContextOf(req), id, membershipId);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/admin/departments/:id/access",
      capability: "departments.manage",
      handler: async (req, res) => {
        const { id } = DepartmentParamsSchema.parse(req.params);
        res.json(await departmentAccess(adminContextOf(req), id));
      },
    },
  ];
}
