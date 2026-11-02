// The occupational health and safety module's API (docs/spec/seguridad-salud.md): PPE catalog, handouts
// and each person's PPE. The server checks the module is on and who sees what.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, apiBlob } from "@/lib/api";

export interface SafetyItem {
  id: string;
  name: string;
  category: string | null;
  hasSizes: boolean;
  lifeMonths: number | null;
  positionIds: string[];
  archived: boolean;
}

export interface SafetyItemInput {
  name: string;
  category: string | null;
  hasSizes: boolean;
  lifeMonths: number | null;
  positionIds: string[];
}

export interface DeliveryLine {
  id: string;
  item: { id: string; name: string };
  quantity: number;
  size: string | null;
  /** «YYYY-MM-DD», a company day; null: no replacement date. */
  replaceOn: string | null;
}

export interface Delivery {
  id: string;
  person: { id: string; name: string };
  deliveredBy: { id: string; name: string };
  deliveredAt: string;
  note: string | null;
  lines: DeliveryLine[];
  voided: { at: string; by: { id: string; name: string }; reason: string } | null;
}

export interface DeliveryFilters {
  person?: string | undefined;
  item?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: "all" | "valid" | "voided" | undefined;
}

export type PpeState = "valid" | "due_soon" | "expired";

export interface PersonPpe {
  person: { id: string; name: string; position: { id: string; name: string } | null };
  current: {
    item: { id: string; name: string };
    quantity: number;
    size: string | null;
    deliveryId: string;
    deliveredAt: string;
    replaceOn: string | null;
    state: PpeState;
  }[];
  missing: { id: string; name: string; expired: boolean }[];
  canDeliver: boolean;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const safetyKeys = {
  all: (slug: string) => ["w", slug, "safety"] as const,
  items: (slug: string) => ["w", slug, "safety", "items"] as const,
  deliveries: (slug: string, filters: DeliveryFilters) =>
    ["w", slug, "safety", "deliveries", filters] as const,
  delivery: (slug: string, id: string) => ["w", slug, "safety", "delivery", id] as const,
  person: (slug: string, id: string) => ["w", slug, "safety", "person", id] as const,
};

export const safetyApi = {
  items: (
    slug: string,
    query: {
      q?: string | undefined;
      cursor?: string | undefined;
      pageSize?: number;
      ids?: readonly string[];
      status?: "active" | "archived" | "all";
    },
    signal?: AbortSignal,
  ) =>
    api<CursorPage<SafetyItem>>(
      w(
        slug,
        `/safety/items?${listQuery({
          q: query.q,
          cursor: query.cursor,
          pageSize: query.pageSize,
          ids: query.ids?.join(","),
          status: query.status,
        })}`,
      ),
      signal === undefined ? {} : { signal },
    ),
  createItem: (slug: string, body: SafetyItemInput) =>
    api<{ item: SafetyItem }>(w(slug, "/safety/items"), { method: "POST", body }),
  updateItem: (slug: string, id: string, body: Partial<SafetyItemInput> & { archived?: boolean }) =>
    api<{ item: SafetyItem }>(w(slug, `/safety/items/${id}`), { method: "PATCH", body }),
  deliveries: (
    slug: string,
    filters: DeliveryFilters,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    api<CursorPage<Delivery>>(w(slug, `/safety/deliveries?${listQuery({ ...filters, cursor })}`), {
      signal,
    }),
  delivery: (slug: string, id: string) =>
    api<{ delivery: Delivery }>(w(slug, `/safety/deliveries/${id}`)),
  createDelivery: (
    slug: string,
    body: {
      membershipId: string;
      lines: { itemId: string; quantity: number; size: string | null }[];
      note: string | null;
      signature: string;
    },
  ) => api<{ delivery: Delivery }>(w(slug, "/safety/deliveries"), { method: "POST", body }),
  voidDelivery: (slug: string, id: string, reason: string) =>
    api<{ delivery: Delivery }>(w(slug, `/safety/deliveries/${id}/void`), {
      method: "POST",
      body: { reason },
    }),
  signature: (slug: string, id: string) => apiBlob(w(slug, `/safety/deliveries/${id}/signature`)),
  pdf: (slug: string, id: string) => apiBlob(w(slug, `/safety/deliveries/${id}/pdf`)),
  person: (slug: string, id: string) => api<PersonPpe>(w(slug, `/safety/people/${id}/ppe`)),
};

// ─── Accidents and incidents ───────────────────────────────────────────────────────────

export type IncidentType = "leave" | "no_leave" | "incident" | "near_miss";
export type IncidentSeverity = "minor" | "serious" | "very_serious" | "fatal";

export interface Incident {
  id: string;
  recordId: string;
  formId: string | null;
  type: IncidentType;
  severity: IncidentSeverity | null;
  occurredOn: string;
  place: string | null;
  person: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  reportedBy: { id: string; name: string };
  status: "OPEN" | "CLOSED";
  closed: { at: string; by: { id: string; name: string } | null } | null;
  actions: { total: number; done: number };
}

export interface SafetyAction {
  id: string;
  description: string;
  responsible: { id: string; name: string };
  dueOn: string;
  done: { at: string; by: { id: string; name: string } | null; note: string | null } | null;
}

export interface IncidentFilters {
  from?: string | undefined;
  to?: string | undefined;
  type?: IncidentType | undefined;
  person?: string | undefined;
  status?: "all" | "open" | "closed" | undefined;
}

export const incidentsKeys = {
  all: (slug: string) => ["w", slug, "safety", "incidents"] as const,
  list: (slug: string, filters: IncidentFilters) =>
    ["w", slug, "safety", "incidents", filters] as const,
  one: (slug: string, id: string) => ["w", slug, "safety", "incidents", "one", id] as const,
  mine: (slug: string) => ["w", slug, "safety", "incidents", "mine"] as const,
  form: (slug: string) => ["w", slug, "safety", "incident-form"] as const,
};

export const incidentsApi = {
  form: (slug: string) =>
    api<{ form: { formId: string; spaceId: string } | null }>(w(slug, "/safety/incident-form")),
  list: (slug: string, filters: IncidentFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<Incident>>(w(slug, `/safety/incidents?${listQuery({ ...filters, cursor })}`), {
      signal,
    }),
  csv: (slug: string, filters: IncidentFilters) =>
    apiBlob(w(slug, `/safety/incidents/export?${listQuery({ ...filters })}`)),
  get: (slug: string, id: string) =>
    api<{ incident: Incident; actions: SafetyAction[] }>(w(slug, `/safety/incidents/${id}`)),
  setStatus: (slug: string, id: string, close: boolean) =>
    api<{ incident: Incident }>(w(slug, `/safety/incidents/${id}/${close ? "close" : "reopen"}`), {
      method: "POST",
    }),
  addAction: (
    slug: string,
    id: string,
    body: { description: string; responsibleId: string; dueOn: string },
  ) =>
    api<{ action: SafetyAction }>(w(slug, `/safety/incidents/${id}/actions`), {
      method: "POST",
      body,
    }),
  done: (slug: string, id: string) =>
    api<{ action: SafetyAction }>(w(slug, `/safety/actions/${id}/done`), {
      method: "POST",
      body: {},
    }),
  mine: (slug: string) => api<{ items: SafetyAction[] }>(w(slug, "/safety/actions")),
};

// ─── Training ────────────────────────────────────────────────────────────────────────────

export type TrainingState = "valid" | "due_soon" | "expired" | "pending";

export interface Course {
  id: string;
  document: { id: string; spaceId: string; code: string; name: string; type: "PAGE" | "FILE" };
  validityMonths: number | null;
  counts: Record<TrainingState, number>;
}

export interface CoursePerson {
  membershipId: string;
  name: string;
  state: TrainingState;
  completedAt: string | null;
  source: "READING" | "IN_PERSON" | null;
  validUntil: string | null;
}

export const trainingKeys = {
  all: (slug: string) => ["w", slug, "safety", "training"] as const,
  course: (slug: string, id: string) => ["w", slug, "safety", "training", id] as const,
  person: (slug: string, id: string) => ["w", slug, "safety", "training", "person", id] as const,
};

export const trainingApi = {
  list: (slug: string, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<Course>>(w(slug, `/safety/courses?${listQuery({ cursor })}`), { signal }),
  create: (slug: string, body: { nodeId: string; validityMonths: number | null }) =>
    api<{ course: Course }>(w(slug, "/safety/courses"), { method: "POST", body }),
  get: (slug: string, id: string) =>
    api<{ course: Course; people: CoursePerson[]; canRecord: boolean }>(
      w(slug, `/safety/courses/${id}`),
    ),
  attendance: (
    slug: string,
    id: string,
    body: { attendees: { membershipId: string; signature: string }[]; completedOn: string },
  ) => api<undefined>(w(slug, `/safety/courses/${id}/attendance`), { method: "POST", body }),
  attendancePdf: (slug: string, id: string, day: string) =>
    apiBlob(w(slug, `/safety/courses/${id}/attendance/pdf?${listQuery({ day })}`)),
  confirm: (slug: string, id: string) =>
    api<undefined>(w(slug, `/safety/courses/${id}/confirm`), { method: "POST" }),
  person: (slug: string, id: string) =>
    api<{
      items: {
        id: string;
        document: Course["document"];
        state: TrainingState;
        validUntil: string | null;
        completedAt: string | null;
      }[];
    }>(w(slug, `/safety/people/${id}/training`)),
};

// ─── Fitness for work ────────────────────────────────────────────────────────────────────

export type FitnessStatus = "APT" | "APT_RESTRICTED" | "NOT_APT";

export interface Fitness {
  id: string;
  status: FitnessStatus;
  validUntil: string | null;
  restrictions: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  state: PpeState | null;
}

export const fitnessKeys = {
  person: (slug: string, id: string) => ["w", slug, "safety", "fitness", id] as const,
};

export const fitnessApi = {
  get: (slug: string, id: string) =>
    api<{ items: Fitness[]; canRecord: boolean }>(w(slug, `/safety/people/${id}/fitness`)),
  record: (
    slug: string,
    id: string,
    body: { status: FitnessStatus; validUntil: string | null; restrictions: string | null },
  ) => api<undefined>(w(slug, `/safety/people/${id}/fitness`), { method: "POST", body }),
};

// ─── People ──────────────────────────────────────────────────────────────────────────────

export interface SafetyPersonRow {
  id: string;
  name: string;
  position: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
  alerts: { missingPpe: number; training: number; fitness: "due_soon" | "expired" | null };
}

export interface PeopleFilters {
  q?: string | undefined;
  position?: string | undefined;
  department?: string | undefined;
}

export const peopleApi = {
  list: (slug: string, filters: PeopleFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<SafetyPersonRow>>(
      w(slug, `/safety/people?${listQuery({ ...filters, cursor })}`),
      {
        signal,
      },
    ),
};
