// The occupational health and safety module (docs/spec/seguridad-salud.md): /admin/safety turns it on or
// off (only the owner, next to the company's language and time zone); /safety/* is the module itself.
import type { Request } from "express";
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { validationMessages } from "../../i18n/index.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { getSafetySettings, updateSafetySettings } from "./safety.service.ts";
import { deliveryPdf } from "./ppe-pdf.ts";
import {
  CreateDeliverySchema,
  CreateItemSchema,
  IdParamsSchema,
  ListDeliveriesQuerySchema,
  ListItemsQuerySchema,
  UpdateItemSchema,
  VoidDeliverySchema,
} from "./ppe.schemas.ts";
import {
  createDelivery,
  createItem,
  deliverySignature,
  getDelivery,
  listDeliveries,
  listItems,
  personPpe,
  updateItem,
  voidDelivery,
} from "./ppe.service.ts";

const HOUR = 3_600_000;

const UpdateSafetySchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    terms: z.enum(["es", "latam"]).optional(),
    examples: z.boolean().optional(),
  })
  .refine((value) => value.enabled !== undefined || value.terms !== undefined, {
    error: () => validationMessages.noChanges,
  });

export function safetyRoutes(deps: Pick<AppDeps, "prisma" | "env">): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    {
      method: "get",
      path: "/admin/safety",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json({ safety: await getSafetySettings(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/admin/safety",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        const changes = UpdateSafetySchema.parse(req.body);
        res.json({ safety: await updateSafetySettings(adminContextOf(req), changes) });
      },
    },
    // PPE (docs/spec/seguridad-salud.md, «EPIs»). The service checks the module is on and who sees what.
    {
      method: "get",
      path: "/safety/items",
      handler: async (req, res) => {
        res.json(await listItems(adminContextOf(req), ListItemsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/safety/items",
      handler: async (req, res) => {
        const item = await createItem(adminContextOf(req), CreateItemSchema.parse(req.body));
        res.status(201).json({ item });
      },
    },
    {
      method: "patch",
      path: "/safety/items/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const item = await updateItem(adminContextOf(req), id, UpdateItemSchema.parse(req.body));
        res.json({ item });
      },
    },
    {
      method: "get",
      path: "/safety/deliveries",
      handler: async (req, res) => {
        res.json(
          await listDeliveries(adminContextOf(req), ListDeliveriesQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/safety/deliveries",
      handler: async (req, res) => {
        const delivery = await createDelivery(
          adminContextOf(req),
          CreateDeliverySchema.parse(req.body),
        );
        res.status(201).json({ delivery });
      },
    },
    {
      method: "get",
      path: "/safety/deliveries/:id",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json({ delivery: await getDelivery(adminContextOf(req), id) });
      },
    },
    {
      method: "get",
      path: "/safety/deliveries/:id/signature",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const png = await deliverySignature(adminContextOf(req), id);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "private, no-store");
        res.send(Buffer.from(png));
      },
    },
    {
      method: "get",
      path: "/safety/deliveries/:id/pdf",
      guards: [
        sensitiveRateLimit(deps, { name: "safety-pdf", windowMs: HOUR, limit: 60, key: byUser }),
      ],
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const file = await deliveryPdf(
          adminContextOf(req),
          { gotenbergUrl: deps.env.GOTENBERG_URL },
          id,
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="entrega.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(Buffer.from(file.body));
      },
    },
    {
      method: "post",
      path: "/safety/deliveries/:id/void",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const { reason } = VoidDeliverySchema.parse(req.body);
        res.json({ delivery: await voidDelivery(adminContextOf(req), id, reason) });
      },
    },
    {
      method: "get",
      path: "/safety/people/:id/ppe",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        res.json(await personPpe(adminContextOf(req), id));
      },
    },
  ];
}
