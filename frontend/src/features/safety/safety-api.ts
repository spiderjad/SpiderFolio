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
  status: IncidentStatus;
  closed: { at: string; by: { id: string; name: string } | null } | null;
  actions: { total: number; done: number };
  /** Days of sick leave (a number only), for the severity rate. */
  lostDays: number | null;
}

/** Open (just reported), under investigation, or closed. */
export type IncidentStatus = "OPEN" | "INVESTIGATING" | "CLOSED";

export type ActionOrigin = "INCIDENT" | "RISK_ASSESSMENT" | "INSPECTION" | "OTHER";
export type ActionPriority = "LOW" | "MEDIUM" | "HIGH";

export const ACTION_ORIGINS: readonly ActionOrigin[] = [
  "INCIDENT",
  "RISK_ASSESSMENT",
  "INSPECTION",
  "OTHER",
];
export const ACTION_PRIORITIES: readonly ActionPriority[] = ["HIGH", "MEDIUM", "LOW"];

/** What a measure comes from, as much as the viewer may see (an accident: no details without health). */
export type ActionReference =
  | { kind: "incident"; id: string | null; label: string }
  | {
      kind: "document";
      id: string;
      spaceId: string | null;
      page: boolean;
      parentId: string | null;
      label: string;
    }
  | { kind: "record"; id: string; formId: string | null; spaceId: string | null; label: string }
  | null;

export interface SafetyAction {
  id: string;
  origin: ActionOrigin;
  reference: ActionReference;
  description: string;
  priority: ActionPriority;
  /** Cents of the company's currency. */
  estimatedCost: number | null;
  responsible: { id: string; name: string };
  dueOn: string;
  overdue: boolean;
  done: { at: string; by: { id: string; name: string } | null; note: string | null } | null;
  canEdit: boolean;
}

export interface ActionInput {
  description: string;
  responsibleId: string;
  dueOn: string;
  priority: ActionPriority;
  estimatedCost: number | null;
}

export type PlannedActionInput = ActionInput &
  (
    | { origin: "RISK_ASSESSMENT"; nodeId: string }
    | { origin: "INSPECTION"; recordId: string }
    | { origin: "OTHER" }
  );

export interface PlanningFilters {
  origin?: ActionOrigin | undefined;
  status?: "open" | "overdue" | "done" | "all" | undefined;
  responsible?: string | undefined;
  priority?: ActionPriority | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

// ─── Accident rates ──────────────────────────────────────────────────────────────────────

export interface RateFigures {
  hours: number | null;
  headcount: number | null;
  accidents: number;
  lostDays: number;
  frequency: number | null;
  severity: number | null;
  incidence: number | null;
}

export interface RatePeriod extends RateFigures {
  from: string;
  to: string;
  missing: number;
}

export interface Indicators {
  year: number;
  months: (RateFigures & { month: string })[];
  ytd: RatePeriod;
  last12: RatePeriod;
  departments: { id: string; name: string; ytd: RatePeriod }[] | null;
}

export interface MonthStat {
  month: string;
  hoursWorked: number | null;
  avgHeadcount: number | null;
}

export const indicatorsKeys = {
  all: (slug: string) => ["w", slug, "safety", "incidents", "indicators"] as const,
  year: (slug: string, year: number) =>
    ["w", slug, "safety", "incidents", "indicators", year] as const,
  stats: (slug: string, year: number, department: string | null) =>
    ["w", slug, "safety", "incidents", "indicators", "stats", year, department] as const,
};

export const indicatorsApi = {
  get: (slug: string, year: number) =>
    api<{ indicators: Indicators }>(w(slug, `/safety/indicators?${listQuery({ year })}`)),
  csv: (slug: string, year: number) =>
    apiBlob(w(slug, `/safety/indicators/csv?${listQuery({ year })}`)),
  stats: (slug: string, year: number, department: string | null) =>
    api<{ items: MonthStat[] }>(
      w(
        slug,
        `/safety/indicators/stats?${listQuery({ year, department: department ?? undefined })}`,
      ),
    ),
  setStat: (
    slug: string,
    body: { month: string; departmentId: string | null; hoursWorked: number; avgHeadcount: number },
  ) => api<{ stat: MonthStat }>(w(slug, "/safety/indicators/stats"), { method: "PUT", body }),
  setLostDays: (slug: string, incidentId: string, lostDays: number | null) =>
    api<{ incident: Incident }>(w(slug, `/safety/incidents/${incidentId}/lost-days`), {
      method: "PUT",
      body: { lostDays },
    }),
};

export const planningKeys = {
  list: (slug: string, filters: PlanningFilters) =>
    ["w", slug, "safety", "incidents", "planning", filters] as const,
};

export const planningApi = {
  list: (slug: string, filters: PlanningFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<SafetyAction>>(
      w(slug, `/safety/planning?${listQuery({ ...filters, cursor })}`),
      { signal },
    ),
  create: (slug: string, body: PlannedActionInput) =>
    api<{ action: SafetyAction }>(w(slug, "/safety/planning"), { method: "POST", body }),
  update: (slug: string, id: string, body: Partial<ActionInput>) =>
    api<{ action: SafetyAction }>(w(slug, `/safety/actions/${id}`), { method: "PATCH", body }),
  csv: (slug: string, filters: PlanningFilters) =>
    apiBlob(w(slug, `/safety/planning/csv?${listQuery({ ...filters })}`)),
};

export interface IncidentFilters {
  from?: string | undefined;
  to?: string | undefined;
  type?: IncidentType | undefined;
  person?: string | undefined;
  status?: "all" | "open" | "investigating" | "closed" | undefined;
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
  setStatus: (slug: string, id: string, status: IncidentStatus) =>
    api<{ incident: Incident }>(
      w(
        slug,
        `/safety/incidents/${id}/${status === "CLOSED" ? "close" : status === "INVESTIGATING" ? "investigate" : "reopen"}`,
      ),
      { method: "POST" },
    ),
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

export interface SignSession {
  id: string;
  course: { id: string; name: string; code: string | null };
  completedOn: string;
  trainer: { id: string; name: string };
  expiresAt: string;
  closedAt: string | null;
  open: boolean;
  /** Only for whoever manages the module, while open. */
  share: { url: string; qr: string } | null;
  attendees: { id: string; name: string; signedAt: string | null }[] | null;
  me: { listed: boolean; signed: boolean };
}

export const trainingKeys = {
  all: (slug: string) => ["w", slug, "safety", "training"] as const,
  session: (slug: string, id: string) => ["w", slug, "safety", "training", "session", id] as const,
  sessions: (slug: string, id: string) =>
    ["w", slug, "safety", "training", "sessions", id] as const,
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
  // Signing on each attendee's own phone (docs/spec/seguridad-salud.md).
  openSession: (slug: string, id: string, body: { attendeeIds: string[]; completedOn: string }) =>
    api<{ session: SignSession }>(w(slug, `/safety/courses/${id}/sign-sessions`), {
      method: "POST",
      body,
    }),
  openSessions: (slug: string, id: string) =>
    api<{ items: SignSession[] }>(w(slug, `/safety/courses/${id}/sign-sessions`)),
  session: (slug: string, id: string) =>
    api<{ session: SignSession }>(w(slug, `/safety/sign-sessions/${id}`)),
  sign: (slug: string, id: string, signature: string) =>
    api<{ session: SignSession }>(w(slug, `/safety/sign-sessions/${id}/sign`), {
      method: "POST",
      body: { signature },
    }),
  closeSession: (slug: string, id: string) =>
    api<{ session: SignSession }>(w(slug, `/safety/sign-sessions/${id}/close`), {
      method: "POST",
    }),
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
  alerts: {
    missingPpe: number;
    replace: number;
    training: number;
    trainingSoon: number;
    fitness: "due_soon" | "expired" | null;
  };
}

export type SafetyAlert = "ppe" | "replace" | "training" | "fitness";

export interface SafetySummary {
  people: number;
  missingPpe: number;
  replace: number;
  training: number;
  trainingSoon: number;
  fitness: number | null;
  actions: { open: number; overdue: number } | null;
  incidents: { open: number; recent: number } | null;
}

export interface PeopleFilters {
  q?: string | undefined;
  position?: string | undefined;
  department?: string | undefined;
  alert?: SafetyAlert | undefined;
}

export const peopleApi = {
  /** The person's sheet as a PDF (health data only for safety.health). */
  pdf: (slug: string, id: string) => apiBlob(w(slug, `/safety/people/${id}/pdf`)),
  summary: (slug: string) => api<{ summary: SafetySummary }>(w(slug, "/safety/summary")),
  myCount: (slug: string) => api<{ count: number | null }>(w(slug, "/safety/me/count")),
  myAlerts: (slug: string) =>
    api<{ alerts: { missingPpe: number; training: number } | null }>(w(slug, "/safety/me/alerts")),
  list: (slug: string, filters: PeopleFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<SafetyPersonRow>>(
      w(slug, `/safety/people?${listQuery({ ...filters, cursor })}`),
      {
        signal,
      },
    ),
};
