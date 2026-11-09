// The environment module (docs/spec/medio-ambiente.md): /admin/environment turns it on or off (only the
// owner); /environment/* is the module itself. Every service checks the module is on and who sees what.
import { environmentLimits } from "@spiderfolio/limits";
import type { Request } from "express";
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  getEnvironmentSettings,
  loadWasteTemplate,
  updateEnvironmentSettings,
} from "./environment.service.ts";
import {
  completeObligation,
  createObligation,
  createPermit,
  listObligations,
  listPermits,
  updateObligation,
  updatePermit,
} from "./permits.service.ts";
import { exportWaste } from "./waste-exports.ts";
import {
  createSample,
  deleteSample,
  listDischargePermits,
  listSamples,
  openNcFromSample,
  setDischargeLimits,
} from "./discharge.service.ts";
import {
  consumptionYear,
  createMeter,
  deleteReading,
  listMeters,
  saveProduction,
  saveReading,
  saveTarget,
  updateMeter,
} from "./consumption.service.ts";
import {
  createCoolingEvent,
  createCoolingUnit,
  deleteCoolingEvent,
  listCoolingEvents,
  listCoolingUnits,
  REFRIGERANT_GWP,
  updateCoolingUnit,
} from "./cooling.service.ts";
import { environmentSummary } from "./summary.service.ts";
import { requireCatalog } from "./environment-access.ts";
import {
  createContractor,
  createMovement,
  createWaste,
  deleteMovement,
  listContractors,
  listMovements,
  listWastes,
  updateContractor,
  updateWaste,
} from "./waste.service.ts";

const L = environmentLimits;
const HOUR = 3_600_000;
const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Name = z.string().trim().min(1).max(L.nameMax);
const Short = z.string().trim().max(L.shortMax);
const Text = z.string().trim().max(L.textMax);
const OptionalShort = z
  .string()
  .trim()
  .max(L.shortMax)
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value));

const IdParams = z.object({ id: Id });
const ArchivedQuery = z.object({ archivado: z.enum(["0", "1"]).default("0") });
const archivedOf = (req: Request) => ArchivedQuery.parse(req.query).archivado === "1";

const SettingsSchema = z.strictObject({ enabled: z.boolean() });

const PermitSchema = z.strictObject({
  kind: z.enum([
    "AAI",
    "ENVIRONMENTAL_LICENSE",
    "DISCHARGE",
    "WASTE_PRODUCER",
    "SANDACH_REGISTRY",
    "EMISSIONS",
    "OTHER",
  ]),
  name: Name,
  authority: Short.default(""),
  reference: Short.default(""),
  issuedOn: Day.nullable().default(null),
  expiresOn: Day.nullable().default(null),
  reviewOn: Day.nullable().default(null),
  conditions: Text.default(""),
  ownerId: Id.nullable().default(null),
});
const PermitUpdateSchema = PermitSchema.extend({ archived: z.boolean().optional() });

const ObligationSchema = z.strictObject({
  name: Name,
  permitId: Id.nullable().default(null),
  everyMonths: z.number().int().min(1).max(L.everyMonthsMax),
  nextDueOn: Day,
  ownerId: Id.nullable().default(null),
  notes: Text.default(""),
});
const ObligationUpdateSchema = ObligationSchema.extend({ archived: z.boolean().optional() });
const DoneSchema = z.strictObject({ doneOn: Day, note: Text.default("") });

const ContractorSchema = z.strictObject({
  name: Name,
  nif: OptionalShort.default(null),
  nima: OptionalShort.default(null),
  authorizations: Text.default(""),
  isManager: z.boolean(),
  isCarrier: z.boolean(),
  authorizationExpiresOn: Day.nullable().default(null),
  contact: Short.default(""),
});
const ContractorUpdateSchema = ContractorSchema.extend({ archived: z.boolean().optional() });

const WasteSchema = z.strictObject({
  name: Name,
  ler: z.string().trim().min(6).max(12),
  sandach: z.enum(["CAT1", "CAT2", "CAT3"]).nullable().default(null),
  operation: z.string().trim().max(10).default(""),
  managerId: Id.nullable().default(null),
  carrierId: Id.nullable().default(null),
  contractRef: Short.default(""),
  maxStorageMonths: z.number().int().min(1).max(L.storageMonthsMax).nullable().default(null),
  storageSince: Day.nullable().default(null),
});
const WasteUpdateSchema = WasteSchema.extend({ archived: z.boolean().optional() });

const MovementSchema = z.strictObject({
  wasteId: Id,
  date: Day,
  quantity: z.number().positive().max(L.quantityMax),
  unit: z.enum(["KG", "T", "L", "M3", "UNITS"]),
  managerId: Id.nullable().default(null),
  carrierId: Id.nullable().default(null),
  documentRef: Short.default(""),
  vehicle: Short.default(""),
  notes: Text.default(""),
});

const MovementsQuery = z.object({
  ...pageShape(["date"], "date"),
  residuo: Id.optional(),
  desde: Day.optional(),
  hasta: Day.optional(),
  sandach: z.enum(["0", "1"]).optional(),
});

const ExportParams = z.object({
  kind: z.enum(["chronological", "sandach", "annual"]),
  format: z.enum(["csv", "pdf"]),
});
const ExportQuery = z.object({ desde: Day, hasta: Day });

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const Decimal = z.number().min(-L.quantityMax).max(L.quantityMax);
const Parameter = z.string().trim().min(1).max(L.shortMax);

const LimitsSchema = z.strictObject({
  limits: z
    .array(
      z.strictObject({
        parameter: Parameter,
        unit: z.string().trim().max(40).default(""),
        min: Decimal.nullable().default(null),
        max: Decimal.nullable().default(null),
      }),
    )
    .max(L.parametersMax),
});
const SampleSchema = z.strictObject({
  permitId: Id,
  takenOn: Day,
  point: Short.default(""),
  laboratory: Short.default(""),
  notes: Text.default(""),
  values: z
    .array(z.strictObject({ parameter: Parameter, value: Decimal }))
    .min(1)
    .max(L.parametersMax),
});
const SamplesQuery = z.object({ autorizacion: Id.optional() });

const MeterSchema = z.strictObject({
  name: Name,
  kind: z.enum([
    "WATER_NETWORK",
    "WATER_WELL",
    "ELECTRICITY",
    "NATURAL_GAS",
    "DIESEL",
    "LPG",
    "OTHER",
  ]),
  unit: z.string().trim().min(1).max(20),
});
const MeterUpdateSchema = MeterSchema.extend({ archived: z.boolean().optional() });
const ReadingSchema = z.strictObject({
  meterId: Id,
  month: Month,
  reading: z.number().min(0).max(L.quantityMax).nullable().default(null),
  consumption: z.number().min(0).max(L.quantityMax).nullable().default(null),
});
const ReadingDeleteSchema = z.strictObject({ meterId: Id, month: Month });
const ProductionSchema = z.strictObject({
  month: Month,
  tonnes: z.number().min(0).max(L.quantityMax),
});
const TargetSchema = z.strictObject({
  meterId: Id,
  year: z.number().int().min(2000).max(2100),
  perTonne: z.number().min(0).max(L.quantityMax).nullable(),
});
const YearQuery = z.object({ anio: z.coerce.number().int().min(2000).max(2100) });

const CoolingUnitSchema = z.strictObject({
  name: Name,
  location: Short.default(""),
  refrigerant: z.string().trim().min(1).max(40),
  chargeKg: z.number().positive().max(1_000_000),
  gwp: z.number().int().min(0).max(30_000).nullable().default(null),
  leakDetection: z.boolean().default(false),
  installer: Short.default(""),
  installedOn: Day.nullable().default(null),
});
const CoolingUnitUpdateSchema = CoolingUnitSchema.extend({ archived: z.boolean().optional() });
const CoolingEventSchema = z.strictObject({
  unitId: Id,
  date: Day,
  kind: z.enum(["LEAK_CHECK", "RECHARGE", "RECOVERY", "REPAIR", "INSPECTION"]),
  kgAdded: z.number().positive().max(1_000_000).nullable().default(null),
  kgRecovered: z.number().positive().max(1_000_000).nullable().default(null),
  leakFound: z.boolean().nullable().default(null),
  company: Short.default(""),
  certificateRef: Short.default(""),
  notes: Text.default(""),
});

export function environmentRoutes(deps: AppDeps): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    {
      method: "get",
      path: "/admin/environment",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json({ environment: await getEnvironmentSettings(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/admin/environment",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        const input = SettingsSchema.parse(req.body);
        res.json({ environment: await updateEnvironmentSettings(adminContextOf(req), input) });
      },
    },
    // ─── Permits and obligations ───
    {
      method: "get",
      path: "/environment/permits",
      handler: async (req, res) => {
        res.json({
          permits: await listPermits(adminContextOf(req), { archived: archivedOf(req) }),
        });
      },
    },
    {
      method: "post",
      path: "/environment/permits",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ permit: await createPermit(adminContextOf(req), PermitSchema.parse(req.body)) });
      },
    },
    {
      method: "put",
      path: "/environment/permits/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          permit: await updatePermit(adminContextOf(req), id, PermitUpdateSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/environment/obligations",
      handler: async (req, res) => {
        res.json({
          obligations: await listObligations(adminContextOf(req), { archived: archivedOf(req) }),
        });
      },
    },
    {
      method: "post",
      path: "/environment/obligations",
      handler: async (req, res) => {
        res.status(201).json({
          obligation: await createObligation(adminContextOf(req), ObligationSchema.parse(req.body)),
        });
      },
    },
    {
      method: "put",
      path: "/environment/obligations/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          obligation: await updateObligation(
            adminContextOf(req),
            id,
            ObligationUpdateSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "post",
      path: "/environment/obligations/:id/done",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          obligation: await completeObligation(adminContextOf(req), id, DoneSchema.parse(req.body)),
        });
      },
    },
    // ─── Waste ───
    {
      method: "get",
      path: "/environment/contractors",
      handler: async (req, res) => {
        res.json({
          contractors: await listContractors(adminContextOf(req), { archived: archivedOf(req) }),
        });
      },
    },
    {
      method: "post",
      path: "/environment/contractors",
      handler: async (req, res) => {
        res.status(201).json({
          contractor: await createContractor(adminContextOf(req), ContractorSchema.parse(req.body)),
        });
      },
    },
    {
      method: "put",
      path: "/environment/contractors/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          contractor: await updateContractor(
            adminContextOf(req),
            id,
            ContractorUpdateSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "get",
      path: "/environment/wastes",
      handler: async (req, res) => {
        res.json({ wastes: await listWastes(adminContextOf(req), { archived: archivedOf(req) }) });
      },
    },
    {
      method: "post",
      path: "/environment/wastes",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ waste: await createWaste(adminContextOf(req), WasteSchema.parse(req.body)) });
      },
    },
    {
      method: "post",
      path: "/environment/wastes/template",
      handler: async (req, res) => {
        res.json(await loadWasteTemplate(adminContextOf(req)));
      },
    },
    {
      method: "put",
      path: "/environment/wastes/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          waste: await updateWaste(adminContextOf(req), id, WasteUpdateSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/environment/movements",
      handler: async (req, res) => {
        const query = MovementsQuery.parse(req.query);
        res.json(
          await listMovements(adminContextOf(req), {
            page: query.page,
            pageSize: query.pageSize,
            cursor: query.cursor,
            wasteId: query.residuo,
            from: query.desde,
            to: query.hasta,
            sandach: query.sandach === "1" ? true : undefined,
          }),
        );
      },
    },
    {
      method: "post",
      path: "/environment/movements",
      handler: async (req, res) => {
        res.status(201).json({
          movement: await createMovement(adminContextOf(req), MovementSchema.parse(req.body)),
        });
      },
    },
    {
      method: "delete",
      path: "/environment/movements/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        await deleteMovement(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    // ─── Summary ───
    {
      method: "get",
      path: "/environment/summary",
      handler: async (req, res) => {
        res.json(await environmentSummary(adminContextOf(req)));
      },
    },
    // ─── Discharges ───
    {
      method: "get",
      path: "/environment/discharge/permits",
      handler: async (req, res) => {
        res.json({ permits: await listDischargePermits(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/environment/discharge/permits/:id/limits",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        const { limits } = LimitsSchema.parse(req.body);
        res.json({ limits: await setDischargeLimits(adminContextOf(req), id, limits) });
      },
    },
    {
      method: "get",
      path: "/environment/discharge/samples",
      handler: async (req, res) => {
        const { autorizacion } = SamplesQuery.parse(req.query);
        res.json({ samples: await listSamples(adminContextOf(req), { permitId: autorizacion }) });
      },
    },
    {
      method: "post",
      path: "/environment/discharge/samples",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ sample: await createSample(adminContextOf(req), SampleSchema.parse(req.body)) });
      },
    },
    {
      method: "delete",
      path: "/environment/discharge/samples/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        await deleteSample(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/environment/discharge/samples/:id/nc",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json(await openNcFromSample(adminContextOf(req), id));
      },
    },
    // ─── Consumption ───
    {
      method: "get",
      path: "/environment/meters",
      handler: async (req, res) => {
        res.json({ meters: await listMeters(adminContextOf(req), { archived: archivedOf(req) }) });
      },
    },
    {
      method: "post",
      path: "/environment/meters",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ meter: await createMeter(adminContextOf(req), MeterSchema.parse(req.body)) });
      },
    },
    {
      method: "put",
      path: "/environment/meters/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          meter: await updateMeter(adminContextOf(req), id, MeterUpdateSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/environment/consumption",
      handler: async (req, res) => {
        const { anio } = YearQuery.parse(req.query);
        res.json(await consumptionYear(adminContextOf(req), anio));
      },
    },
    {
      method: "put",
      path: "/environment/readings",
      handler: async (req, res) => {
        await saveReading(adminContextOf(req), ReadingSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/environment/readings/delete",
      handler: async (req, res) => {
        await deleteReading(adminContextOf(req), ReadingDeleteSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "put",
      path: "/environment/production",
      handler: async (req, res) => {
        await saveProduction(adminContextOf(req), ProductionSchema.parse(req.body));
        res.status(204).end();
      },
    },
    {
      method: "put",
      path: "/environment/targets",
      handler: async (req, res) => {
        await saveTarget(adminContextOf(req), TargetSchema.parse(req.body));
        res.status(204).end();
      },
    },
    // ─── Cooling units ───
    {
      method: "get",
      path: "/environment/cooling/refrigerants",
      handler: async (req, res) => {
        await requireCatalog(adminContextOf(req));
        res.json({ refrigerants: REFRIGERANT_GWP });
      },
    },
    {
      method: "get",
      path: "/environment/cooling/units",
      handler: async (req, res) => {
        res.json({
          units: await listCoolingUnits(adminContextOf(req), { archived: archivedOf(req) }),
        });
      },
    },
    {
      method: "post",
      path: "/environment/cooling/units",
      handler: async (req, res) => {
        res.status(201).json({
          unit: await createCoolingUnit(adminContextOf(req), CoolingUnitSchema.parse(req.body)),
        });
      },
    },
    {
      method: "put",
      path: "/environment/cooling/units/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({
          unit: await updateCoolingUnit(
            adminContextOf(req),
            id,
            CoolingUnitUpdateSchema.parse(req.body),
          ),
        });
      },
    },
    {
      method: "get",
      path: "/environment/cooling/units/:id/events",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        res.json({ events: await listCoolingEvents(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/environment/cooling/events",
      handler: async (req, res) => {
        res.status(201).json({
          unit: await createCoolingEvent(adminContextOf(req), CoolingEventSchema.parse(req.body)),
        });
      },
    },
    {
      method: "delete",
      path: "/environment/cooling/events/:id",
      handler: async (req, res) => {
        const { id } = IdParams.parse(req.params);
        await deleteCoolingEvent(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/environment/exports/:kind/:format",
      guards: [
        sensitiveRateLimit(deps, {
          name: "environment-export",
          windowMs: HOUR,
          limit: 30,
          key: byUser,
        }),
      ],
      handler: async (req, res) => {
        const { kind, format } = ExportParams.parse(req.params);
        const { desde, hasta } = ExportQuery.parse(req.query);
        const file = await exportWaste(
          adminContextOf(req),
          { gotenbergUrl: deps.env.GOTENBERG_URL },
          { kind, format, from: desde, to: hasta },
        );
        res.setHeader("Content-Type", file.contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.send(typeof file.body === "string" ? file.body : Buffer.from(file.body));
      },
    },
  ];
}
