// The environment module's API (docs/spec/medio-ambiente.md): permits and obligations, the waste
// catalog, waste managers and carriers, collections and the exports. The server checks the module is on
// and who sees what.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, apiBlob } from "@/lib/api";

export const PERMIT_KINDS = [
  "AAI",
  "ENVIRONMENTAL_LICENSE",
  "DISCHARGE",
  "WASTE_PRODUCER",
  "SANDACH_REGISTRY",
  "EMISSIONS",
  "OTHER",
] as const;
export const SANDACH = ["CAT1", "CAT2", "CAT3"] as const;
export const UNITS = ["KG", "T", "L", "M3", "UNITS"] as const;

export type PermitKind = (typeof PERMIT_KINDS)[number];
export type Sandach = (typeof SANDACH)[number];
export type Unit = (typeof UNITS)[number];

export interface PersonRef {
  id: string;
  name: string;
}
export interface FolderRef {
  spaceId: string;
  id: string;
}

export interface Permit {
  id: string;
  kind: PermitKind;
  name: string;
  authority: string;
  reference: string;
  issuedOn: string | null;
  expiresOn: string | null;
  reviewOn: string | null;
  conditions: string;
  owner: PersonRef | null;
  folder: FolderRef | null;
  archived: boolean;
}

export interface PermitInput {
  kind: PermitKind;
  name: string;
  authority: string;
  reference: string;
  issuedOn: string | null;
  expiresOn: string | null;
  reviewOn: string | null;
  conditions: string;
  ownerId: string | null;
  archived?: boolean;
}

export interface Obligation {
  id: string;
  name: string;
  permit: { id: string; name: string } | null;
  everyMonths: number;
  lastDoneOn: string | null;
  nextDueOn: string;
  owner: PersonRef | null;
  notes: string;
  archived: boolean;
  history: { doneOn: string; note: string; by: string }[];
}

export interface ObligationInput {
  name: string;
  permitId: string | null;
  everyMonths: number;
  nextDueOn: string;
  ownerId: string | null;
  notes: string;
  archived?: boolean;
}

export interface Contractor {
  id: string;
  name: string;
  nif: string | null;
  nima: string | null;
  authorizations: string;
  isManager: boolean;
  isCarrier: boolean;
  authorizationExpiresOn: string | null;
  contact: string;
  folder: FolderRef | null;
  archived: boolean;
}

export interface ContractorInput {
  name: string;
  nif: string | null;
  nima: string | null;
  authorizations: string;
  isManager: boolean;
  isCarrier: boolean;
  authorizationExpiresOn: string | null;
  contact: string;
  archived?: boolean;
}

export interface Waste {
  id: string;
  name: string;
  ler: string;
  hazardous: boolean;
  sandach: Sandach | null;
  operation: string;
  manager: { id: string; name: string } | null;
  carrier: { id: string; name: string } | null;
  contractRef: string;
  maxStorageMonths: number;
  storageSince: string | null;
  storageUntil: string | null;
  archived: boolean;
}

export interface WasteInput {
  name: string;
  ler: string;
  sandach: Sandach | null;
  operation: string;
  managerId: string | null;
  carrierId: string | null;
  contractRef: string;
  maxStorageMonths: number | null;
  storageSince: string | null;
  archived?: boolean;
}

export interface Movement {
  id: string;
  date: string;
  waste: { id: string; name: string; ler: string; hazardous: boolean; sandach: Sandach | null };
  quantity: number;
  unit: Unit;
  manager: { id: string; name: string; nima: string | null } | null;
  carrier: { id: string; name: string } | null;
  operation: string;
  documentRef: string;
  vehicle: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
}

export interface MovementInput {
  wasteId: string;
  date: string;
  quantity: number;
  unit: Unit;
  managerId: string | null;
  carrierId: string | null;
  documentRef: string;
  vehicle: string;
  notes: string;
}

export interface MovementFilters {
  residuo?: string | undefined;
  desde?: string | undefined;
  hasta?: string | undefined;
  sandach?: "1" | undefined;
}

export type ExportKind = "chronological" | "sandach" | "annual";

const w = (slug: string, path: string) => `/w/${slug}${path}`;
const archivedQuery = (archived: boolean) => (archived ? "?archivado=1" : "");

export const environmentKeys = {
  all: (slug: string) => ["w", slug, "environment"] as const,
  settings: (slug: string) => ["w", slug, "environment", "settings"] as const,
  permits: (slug: string, archived: boolean) =>
    ["w", slug, "environment", "permits", archived] as const,
  obligations: (slug: string, archived: boolean) =>
    ["w", slug, "environment", "obligations", archived] as const,
  contractors: (slug: string, archived: boolean) =>
    ["w", slug, "environment", "contractors", archived] as const,
  wastes: (slug: string, archived: boolean) =>
    ["w", slug, "environment", "wastes", archived] as const,
  movements: (slug: string, filters: MovementFilters) =>
    ["w", slug, "environment", "movements", filters] as const,
};

export const environmentApi = {
  settings: (slug: string) =>
    api<{ environment: { enabled: boolean; space: { id: string; name: string } | null } }>(
      w(slug, "/admin/environment"),
    ),
  saveSettings: (slug: string, enabled: boolean) =>
    api<{ environment: { enabled: boolean; space: { id: string; name: string } | null } }>(
      w(slug, "/admin/environment"),
      { method: "PUT", body: { enabled } },
    ),
  permits: (slug: string, archived: boolean) =>
    api<{ permits: Permit[] }>(w(slug, `/environment/permits${archivedQuery(archived)}`)),
  createPermit: (slug: string, body: PermitInput) =>
    api<{ permit: Permit }>(w(slug, "/environment/permits"), { method: "POST", body }),
  updatePermit: (slug: string, id: string, body: PermitInput) =>
    api<{ permit: Permit }>(w(slug, `/environment/permits/${id}`), { method: "PUT", body }),
  obligations: (slug: string, archived: boolean) =>
    api<{ obligations: Obligation[] }>(
      w(slug, `/environment/obligations${archivedQuery(archived)}`),
    ),
  createObligation: (slug: string, body: ObligationInput) =>
    api<{ obligation: Obligation }>(w(slug, "/environment/obligations"), { method: "POST", body }),
  updateObligation: (slug: string, id: string, body: ObligationInput) =>
    api<{ obligation: Obligation }>(w(slug, `/environment/obligations/${id}`), {
      method: "PUT",
      body,
    }),
  completeObligation: (slug: string, id: string, body: { doneOn: string; note: string }) =>
    api<{ obligation: Obligation }>(w(slug, `/environment/obligations/${id}/done`), {
      method: "POST",
      body,
    }),
  contractors: (slug: string, archived: boolean) =>
    api<{ contractors: Contractor[] }>(
      w(slug, `/environment/contractors${archivedQuery(archived)}`),
    ),
  createContractor: (slug: string, body: ContractorInput) =>
    api<{ contractor: Contractor }>(w(slug, "/environment/contractors"), { method: "POST", body }),
  updateContractor: (slug: string, id: string, body: ContractorInput) =>
    api<{ contractor: Contractor }>(w(slug, `/environment/contractors/${id}`), {
      method: "PUT",
      body,
    }),
  wastes: (slug: string, archived: boolean) =>
    api<{ wastes: Waste[] }>(w(slug, `/environment/wastes${archivedQuery(archived)}`)),
  createWaste: (slug: string, body: WasteInput) =>
    api<{ waste: Waste }>(w(slug, "/environment/wastes"), { method: "POST", body }),
  updateWaste: (slug: string, id: string, body: WasteInput) =>
    api<{ waste: Waste }>(w(slug, `/environment/wastes/${id}`), { method: "PUT", body }),
  loadTemplate: (slug: string) =>
    api<{ added: number }>(w(slug, "/environment/wastes/template"), { method: "POST" }),
  movements: (
    slug: string,
    filters: MovementFilters,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    api<CursorPage<Movement>>(
      w(slug, `/environment/movements?${listQuery({ ...filters, cursor })}`),
      { signal },
    ),
  createMovement: (slug: string, body: MovementInput) =>
    api<{ movement: Movement }>(w(slug, "/environment/movements"), { method: "POST", body }),
  deleteMovement: (slug: string, id: string) =>
    api<undefined>(w(slug, `/environment/movements/${id}`), { method: "DELETE" }),
  exportFile: (slug: string, kind: ExportKind, format: "csv" | "pdf", from: string, to: string) =>
    apiBlob(
      w(slug, `/environment/exports/${kind}/${format}?${listQuery({ desde: from, hasta: to })}`),
    ),
};

// ─── Summary, discharges, consumption and cooling units ─────────────────────────────────────

export const METER_KINDS = [
  "WATER_NETWORK",
  "WATER_WELL",
  "ELECTRICITY",
  "NATURAL_GAS",
  "DIESEL",
  "LPG",
  "OTHER",
] as const;
export const COOLING_EVENTS = [
  "LEAK_CHECK",
  "RECHARGE",
  "RECOVERY",
  "REPAIR",
  "INSPECTION",
] as const;

export type MeterKind = (typeof METER_KINDS)[number];
export type CoolingEventKind = (typeof COOLING_EVENTS)[number];

export interface EnvironmentSummary {
  today: string;
  due: {
    kind: "permit" | "obligation" | "contractor" | "storage" | "leak_check";
    id: string;
    name: string;
    dueOn: string;
  }[];
  samplesOut: { id: string; permit: string; takenOn: string; outOfLimits: number }[];
  lastMonth: {
    month: string;
    meters: { name: string; unit: string; consumption: number | null; previous: number | null }[];
  };
}

export interface DischargeLimit {
  id?: string;
  parameter: string;
  unit: string;
  min: number | null;
  max: number | null;
}

export interface DischargePermit {
  id: string;
  name: string;
  reference: string;
  limits: DischargeLimit[];
}

export interface Sample {
  id: string;
  permit: { id: string; name: string };
  takenOn: string;
  point: string;
  laboratory: string;
  notes: string;
  values: {
    parameter: string;
    value: number;
    unit: string;
    min: number | null;
    max: number | null;
    out: boolean;
  }[];
  outOfLimits: number;
  ncId: string | null;
  recordedBy: string;
}

export interface SampleInput {
  permitId: string;
  takenOn: string;
  point: string;
  laboratory: string;
  notes: string;
  values: { parameter: string; value: number }[];
}

export interface Meter {
  id: string;
  name: string;
  kind: MeterKind;
  unit: string;
  archived: boolean;
}

export interface ConsumptionYear {
  year: number;
  production: { month: string; tonnes: number | null }[];
  tonnes: number;
  meters: {
    meter: Meter;
    months: {
      month: string;
      reading: number | null;
      consumption: number | null;
      previous: number | null;
      perTonne: number | null;
    }[];
    total: number;
    previousTotal: number | null;
    perTonne: number | null;
    target: number | null;
  }[];
}

export interface CoolingUnit {
  id: string;
  name: string;
  location: string;
  refrigerant: string;
  chargeKg: number;
  gwp: number;
  leakDetection: boolean;
  installer: string;
  installedOn: string | null;
  co2Tonnes: number;
  fluorinated: boolean;
  checkEveryMonths: number | null;
  restricted: boolean;
  lastCheckOn: string | null;
  nextCheckOn: string | null;
  archived: boolean;
}

export interface CoolingUnitInput {
  name: string;
  location: string;
  refrigerant: string;
  chargeKg: number;
  gwp: number | null;
  leakDetection: boolean;
  installer: string;
  installedOn: string | null;
  archived?: boolean;
}

export interface CoolingEvent {
  id: string;
  date: string;
  kind: CoolingEventKind;
  kgAdded: number | null;
  kgRecovered: number | null;
  leakFound: boolean | null;
  company: string;
  certificateRef: string;
  notes: string;
  recordedBy: string;
}

export interface CoolingEventInput {
  unitId: string;
  date: string;
  kind: CoolingEventKind;
  kgAdded: number | null;
  kgRecovered: number | null;
  leakFound: boolean | null;
  company: string;
  certificateRef: string;
  notes: string;
}

const env = (slug: string, path: string) => `/w/${slug}/environment${path}`;

export const environmentMoreKeys = {
  summary: (slug: string) => ["w", slug, "environment", "summary"] as const,
  dischargePermits: (slug: string) => ["w", slug, "environment", "discharge", "permits"] as const,
  samples: (slug: string, permitId: string | null) =>
    ["w", slug, "environment", "discharge", "samples", permitId] as const,
  meters: (slug: string, archived: boolean) =>
    ["w", slug, "environment", "meters", archived] as const,
  consumption: (slug: string, year: number) =>
    ["w", slug, "environment", "consumption", year] as const,
  coolingUnits: (slug: string, archived: boolean) =>
    ["w", slug, "environment", "cooling", archived] as const,
  coolingEvents: (slug: string, unitId: string) =>
    ["w", slug, "environment", "cooling", "events", unitId] as const,
  refrigerants: (slug: string) => ["w", slug, "environment", "refrigerants"] as const,
};

export const environmentMoreApi = {
  summary: (slug: string) => api<EnvironmentSummary>(env(slug, "/summary")),
  dischargePermits: (slug: string) =>
    api<{ permits: DischargePermit[] }>(env(slug, "/discharge/permits")),
  saveLimits: (slug: string, permitId: string, limits: DischargeLimit[]) =>
    api<{ limits: DischargeLimit[] }>(env(slug, `/discharge/permits/${permitId}/limits`), {
      method: "PUT",
      body: {
        limits: limits.map(({ parameter, unit, min, max }) => ({ parameter, unit, min, max })),
      },
    }),
  samples: (slug: string, permitId: string | null) =>
    api<{ samples: Sample[] }>(
      env(slug, `/discharge/samples${permitId === null ? "" : `?autorizacion=${permitId}`}`),
    ),
  createSample: (slug: string, body: SampleInput) =>
    api<{ sample: Sample }>(env(slug, "/discharge/samples"), { method: "POST", body }),
  deleteSample: (slug: string, id: string) =>
    api<undefined>(env(slug, `/discharge/samples/${id}`), { method: "DELETE" }),
  openNc: (slug: string, id: string) =>
    api<{ ncId: string }>(env(slug, `/discharge/samples/${id}/nc`), { method: "POST" }),
  meters: (slug: string, archived: boolean) =>
    api<{ meters: Meter[] }>(env(slug, `/meters${archived ? "?archivado=1" : ""}`)),
  createMeter: (slug: string, body: { name: string; kind: MeterKind; unit: string }) =>
    api<{ meter: Meter }>(env(slug, "/meters"), { method: "POST", body }),
  updateMeter: (
    slug: string,
    id: string,
    body: { name: string; kind: MeterKind; unit: string; archived?: boolean },
  ) => api<{ meter: Meter }>(env(slug, `/meters/${id}`), { method: "PUT", body }),
  consumption: (slug: string, year: number) =>
    api<ConsumptionYear>(env(slug, `/consumption?anio=${String(year)}`)),
  saveReading: (
    slug: string,
    body: { meterId: string; month: string; reading: number | null; consumption: number | null },
  ) => api<undefined>(env(slug, "/readings"), { method: "PUT", body }),
  deleteReading: (slug: string, body: { meterId: string; month: string }) =>
    api<undefined>(env(slug, "/readings/delete"), { method: "POST", body }),
  saveProduction: (slug: string, body: { month: string; tonnes: number }) =>
    api<undefined>(env(slug, "/production"), { method: "PUT", body }),
  saveTarget: (slug: string, body: { meterId: string; year: number; perTonne: number | null }) =>
    api<undefined>(env(slug, "/targets"), { method: "PUT", body }),
  refrigerants: (slug: string) =>
    api<{ refrigerants: Record<string, number> }>(env(slug, "/cooling/refrigerants")),
  coolingUnits: (slug: string, archived: boolean) =>
    api<{ units: CoolingUnit[] }>(env(slug, `/cooling/units${archived ? "?archivado=1" : ""}`)),
  createCoolingUnit: (slug: string, body: CoolingUnitInput) =>
    api<{ unit: CoolingUnit }>(env(slug, "/cooling/units"), { method: "POST", body }),
  updateCoolingUnit: (slug: string, id: string, body: CoolingUnitInput) =>
    api<{ unit: CoolingUnit }>(env(slug, `/cooling/units/${id}`), { method: "PUT", body }),
  coolingEvents: (slug: string, unitId: string) =>
    api<{ events: CoolingEvent[] }>(env(slug, `/cooling/units/${unitId}/events`)),
  createCoolingEvent: (slug: string, body: CoolingEventInput) =>
    api<{ unit: CoolingUnit }>(env(slug, "/cooling/events"), { method: "POST", body }),
  deleteCoolingEvent: (slug: string, id: string) =>
    api<undefined>(env(slug, `/cooling/events/${id}`), { method: "DELETE" }),
};
