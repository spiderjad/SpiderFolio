// Tipos y llamadas de la API del panel (/api/v1/w/:slug/admin, CLAUDE.md sección 9.4). Los tipos
// reflejan las respuestas del backend; las claves de consulta incluyen siempre el workspace.
import type { SystemRole } from "@/auth/types";
import { api } from "@/lib/api";
import type { Locale } from "@/i18n";

export type SeatType = "FULL" | "READER";
/** Quién ve a quién en el directorio: toda la empresa o solo su departamento. */
export type MemberVisibility = "company" | "department";

export interface SecuritySettings {
  memberVisibility: MemberVisibility;
  /** Los jefes y subjefes pueden invitar a su área. */
  leadersCanInvite: boolean;
  /** El autor puede aprobar sus propios documentos controlados. */
  allowSelfApproval: boolean;
  /** Bian, el asistente IA, activo en la empresa. */
  bianEnabled: boolean;
  /** Los invitados externos pueden usar a Bian. */
  bianGuests: boolean;
  /** Idioma por defecto de la empresa. */
  locale: Locale;
}
/** Cargo en un departamento: un solo jefe, uno o más subjefes y el resto miembros. */
export type DepartmentPosition = "HEAD" | "DEPUTY" | "MEMBER";

export type SmtpSecurity = "TLS" | "STARTTLS";
export type EmailStatus = "DRAFT" | "ACTIVE" | "DISABLED";

/** Remitente de email propio (Seguridad › Email). La contraseña nunca viene: solo `hasPassword`. */
export interface DnsRecord {
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  verified: boolean;
}

export interface EmailDomain {
  name: string;
  status: "PENDING" | "VERIFIED";
  records: DnsRecord[];
  verifiedAt: string | null;
}

export interface EmailDomainInput {
  domain: string;
  fromName: string;
  fromLocalPart: string;
  replyTo: string | null;
}

export interface EmailSettings {
  included: boolean;
  available: boolean;
  /** Hay un proveedor para el modo Dominio. */
  domainAvailable: boolean;
  config: {
    domain: EmailDomain | null;
    mode: "SMTP" | "DOMAIN";
    status: EmailStatus;
    fromName: string | null;
    fromEmail: string | null;
    replyTo: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecurity: SmtpSecurity;
    smtpUser: string | null;
    hasPassword: boolean;
    tested: boolean;
    testedAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    lastFallbackAlertAt: string | null;
  } | null;
}

export interface EmailSettingsInput {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUser: string | null;
  /** Ausente: se conserva la guardada. */
  smtpPass?: string;
}

export interface EmailTestResponse {
  result: { ok: boolean; code?: string; message?: string };
  settings: EmailSettings;
}
export type MemberStatus = "ACTIVE" | "SUSPENDED";

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  base: SystemRole;
  capabilities: string[];
  isSystem: boolean;
  memberCount: number;
  pendingInvitations: number;
}

export interface DepartmentView {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  parentId: string | null;
  parentName: string | null;
  /** Subdepartamentos directos. */
  childCount: number;
  head: { membershipId: string; name: string } | null;
  deputies: { membershipId: string; name: string }[];
  /** Personas del departamento, jefe y subjefes incluidos. */
  memberCount: number;
  /** "manage": lo gestiona quien mira; "read": solo lo ve (nombre, puesto y cargo). */
  access: "manage" | "read";
}

/** Departamento como opción de un selector: nivel en el árbol y ruta de ancestros. */
export interface DepartmentOptionView extends DepartmentView {
  depth: number;
  path: string[];
}

export interface MemberView {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** null en las personas que entran con usuario y PIN. */
  email: string | null;
  emailVerified: boolean;
  jobTitle: string | null;
  roleId: string;
  roleName: string;
  roleBase: SystemRole;
  seatType: SeatType;
  status: MemberStatus;
  /** Departamentos a los que pertenece, con su cargo en cada uno. */
  departments: { id: string; name: string; position: DepartmentPosition }[];
  /** Los que lidera: jefe o subjefe (subconjunto de `departments`). */
  managedDepartments: { id: string; name: string; position: "HEAD" | "DEPUTY" }[];
  /** El rol tiene capacidades con alcance propio (rigen en los departamentos que lidera). */
  /** "PIN": lector de planta que entra con usuario y PIN, sin email. */
  kind: "STANDARD" | "PIN";
  loginName: string | null;
  /** El PIN está bloqueado por demasiados intentos fallidos. */
  pinLocked: boolean;
  /** Tiene activa la verificación en dos pasos. */
  twoFactor: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  isSelf: boolean;
}

/** Respuesta de toda lista paginada en el servidor. */
/** Respuesta de toda lista: se pide por cursor (scroll infinito), `nextCursor` null = no hay más. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  nextCursor: string | null;
}

export type MemberList = Page<MemberView>;

/** Grupos de las tarjetas y del filtro: por rol y plaza, y "managers" por cargo (cualquier rol). */
export type MemberGroup = "owner" | "admins" | "managers" | "members" | "readers";

export interface MemberSummary {
  owners: number;
  admins: number;
  managers: number;
  members: number;
  readers: number;
  total: number;
}

/**
 * Persona del organigrama (DTO de directorio). Los datos de gestión llegan solo si la persona
 * está dentro del alcance de gestión de quien mira (docs/spec/personas.md).
 */
export interface OrgPersonView {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  departments: { id: string; name: string; position: DepartmentPosition }[];
  managedDepartments: { id: string; name: string; position: "HEAD" | "DEPUTY" }[];
  isSelf: boolean;
  management: {
    email: string | null;
    emailVerified: boolean;
    roleName: string;
    roleBase: SystemRole;
    seatType: SeatType;
    status: MemberStatus;
    lastSeenAt: string | null;
  } | null;
}

/**
 * Lo que necesitan las filas de personas, vengan de la lista de gestión (MemberView) o del
 * organigrama (OrgPersonView). Lo que el servidor no revela queda en null.
 */
export interface ReviewGroup {
  total: number;
  items: { id: string; name: string }[];
}

export interface StructureReview {
  departmentsWithoutHead: ReviewGroup;
  peopleWithoutDepartment: ReviewGroup;
  readerLeaders: ReviewGroup;
  adminLeaders: ReviewGroup;
  emptyDepartments: ReviewGroup;
}

export interface PersonData {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  isSelf: boolean;
  departments: { id: string; name: string; position: DepartmentPosition }[];
  managedDepartments: { id: string; name: string; position: "HEAD" | "DEPUTY" }[];
  email: string | null;
  status: MemberStatus | null;
  roleName: string | null;
  roleBase: SystemRole | null;
  seatType: SeatType | null;
}

/** Aplana a una persona del organigrama: sin datos de gestión, esos campos quedan en null. */
export function asPerson(person: OrgPersonView): PersonData {
  const { management, ...rest } = person;
  return {
    ...rest,
    email: management?.email ?? null,
    status: management?.status ?? null,
    roleName: management?.roleName ?? null,
    roleBase: management?.roleBase ?? null,
    seatType: management?.seatType ?? null,
  };
}

export interface DepartmentBlock {
  department: DepartmentView;
  head: OrgPersonView | null;
  deputies: OrgPersonView[];
  /** Solo quienes no tienen cargo. */
  members: { items: OrgPersonView[]; total: number; nextCursor: string | null };
}

export interface UnassignedBlock {
  members: { items: OrgPersonView[]; total: number; nextCursor: string | null };
}

/** Persona del directorio (nombre, puesto y departamentos; sin datos de gestión). */
export interface DirectoryEntry {
  id: string;
  name: string;
  jobTitle: string | null;
  departments: { id: string; name: string; position: DepartmentPosition }[];
}

export interface OrgChart {
  /** Opción de Seguridad "Los miembros ven" (quien ve todo recibe un aviso si es "department"). */
  memberVisibility: MemberVisibility;
  company: { name: string; owner: { membershipId: string; name: string } | null };
  departments: Page<DepartmentBlock>;
  /** Solo en la raíz. */
  unassigned: UnassignedBlock | null;
}

export interface OrgSearchHit {
  membershipId: string;
  name: string;
  places: { departmentId: string; departmentName: string; path: string[] }[];
}

export interface InvitationView {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  seatType: SeatType;
  departmentIds: string[];
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "expired";
}

export type Seats = Record<SeatType, { used: number; max: number | null }>;

export interface CapabilityInfo {
  groups: { id: string; capabilities: string[] }[];
  all: string[];
  grantable: string[];
  /** Capacidades de los plugins instalados, con su texto. */
  plugins: { id: string; label: string; description: string }[];
}

export interface PinSettings {
  enabled: boolean;
  idleMinutes: number;
  closeAfterConfirm: boolean;
}

export interface MemberQuery {
  q: string;
  /** Para mostrar personas ya elegidas (combobox). */
  ids?: readonly string[];
  role: string;
  /** Un departamento, o "none" para quien no pertenece a ninguno. */
  department: string;
  group: "" | MemberGroup | "direction";
  status: "" | MemberStatus;
  page?: number | undefined;
  /** Cursor de la página pedida (el `nextCursor` de la anterior). */
  cursor?: string | undefined;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
}

export type BulkAction =
  | { type: "change_role"; roleId: string }
  | { type: "change_departments"; mode: "add" | "remove" | "set"; departmentIds: string[] }
  | { type: "change_seat"; seatType: SeatType }
  | { type: "suspend" }
  | { type: "reactivate" };

export interface BulkResult {
  results: ({ id: string; ok: true } | { id: string; ok: false; code: string; message: string })[];
  succeeded: number;
  failed: number;
}

export interface ImportRowResult {
  line: number;
  email: string;
  status: "ok" | "skip" | "error";
  reason?: string;
  roleName?: string;
}

export interface ImportPreview {
  rows: ImportRowResult[];
  summary: { ok: number; skip: number; error: number };
}

const admin = (slug: string, path: string) => `/w/${slug}/admin${path}`;

export const adminKeys = {
  all: (slug: string) => ["w", slug, "admin"] as const,
  members: (slug: string, query?: MemberQuery) =>
    query === undefined
      ? (["w", slug, "admin", "members"] as const)
      : (["w", slug, "admin", "members", query] as const),
  invitations: (slug: string) => ["w", slug, "admin", "invitations"] as const,
  seats: (slug: string) => ["w", slug, "admin", "seats"] as const,
  roles: (slug: string) => ["w", slug, "admin", "roles"] as const,
  capabilities: (slug: string) => ["w", slug, "admin", "capabilities"] as const,
  departments: (slug: string) => ["w", slug, "admin", "departments"] as const,
  department: (slug: string, id: string) => ["w", slug, "admin", "departments", id] as const,
  summary: (slug: string) => ["w", slug, "admin", "members", "summary"] as const,
  structureReview: (slug: string) => ["w", slug, "admin", "structure-review"] as const,
  pinSettings: (slug: string) => ["w", slug, "admin", "pin-settings"] as const,
  security: (slug: string) => ["w", slug, "admin", "security"] as const,
  email: (slug: string) => ["w", slug, "admin", "email"] as const,
  roleOptions: (slug: string) => ["w", slug, "admin", "roles", "options"] as const,
  departmentOptions: (slug: string) => ["w", slug, "admin", "departments", "options"] as const,
};

function queryString(query: MemberQuery): string {
  const params = new URLSearchParams();
  if (query.q !== "") params.set("q", query.q);
  if (query.ids !== undefined && query.ids.length > 0) params.set("ids", query.ids.join(","));
  if (query.role !== "") params.set("role", query.role);
  if (query.department !== "") params.set("department", query.department);
  if (query.group !== "") params.set("group", query.group);
  if (query.status !== "") params.set("status", query.status);
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  else params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize));
  params.set("sort", query.sort);
  params.set("dir", query.dir);
  return params.toString();
}

/** Parámetros de una lista paginada: solo los que tienen valor. */
export function listQuery(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

/** Consulta de un combobox: texto, página y, para mostrar lo ya elegido, ids. */
export interface OptionsQuery {
  q?: string;
  page?: number;
  cursor?: string | undefined;
  pageSize?: number;
  ids?: readonly string[];
}

function optionsQueryString(query: OptionsQuery): string {
  return listQuery({
    q: query.q,
    page: query.page,
    cursor: query.cursor,
    pageSize: query.pageSize,
    ids: query.ids?.join(","),
  });
}

export interface RoleQuery {
  q: string;
  kind: "" | "system" | "custom";
  page?: number | undefined;
  cursor?: string | undefined;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
}

export interface DepartmentQuery {
  q: string;
  parent: string;
  /** Solo los que lidera quien consulta (alcance propio). */
  led?: boolean;
  page?: number | undefined;
  cursor?: string | undefined;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
}

export interface InvitationQuery {
  q: string;
  status: "" | "pending" | "expired";
  page?: number | undefined;
  cursor?: string | undefined;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
}

export const adminApi = {
  createPinMember: (
    slug: string,
    body: {
      name: string;
      loginName: string;
      roleId: string;
      departmentIds: string[];
      pin?: string;
    },
  ) =>
    api<{ member: MemberView; pin: string }>(admin(slug, "/members/pin"), {
      method: "POST",
      body,
    }),
  resetPin: (slug: string, id: string) =>
    api<{ member: MemberView; loginName: string; pin: string }>(
      admin(slug, `/members/${id}/pin/reset`),
      { method: "POST", body: {} },
    ),
  pinSettings: (slug: string) =>
    api<{ settings: PinSettings }>(admin(slug, "/members/pin-settings")),
  updatePinSettings: (slug: string, body: Partial<PinSettings>) =>
    api<{ settings: PinSettings }>(admin(slug, "/members/pin-settings"), {
      method: "PATCH",
      body,
    }),
  structureReview: (slug: string) => api<StructureReview>(admin(slug, "/structure-review")),
  member: (slug: string, id: string) => api<{ member: MemberView }>(admin(slug, `/members/${id}`)),
  memberSummary: (slug: string) => api<MemberSummary>(admin(slug, "/members/summary")),
  securitySettings: (slug: string) => api<{ settings: SecuritySettings }>(admin(slug, "/security")),
  updateSecuritySettings: (slug: string, body: Partial<SecuritySettings>) =>
    api<{ settings: SecuritySettings }>(admin(slug, "/security"), {
      method: "PATCH",
      body,
    }),
  emailSettings: (slug: string) => api<EmailSettings>(admin(slug, "/email")),
  updateEmailSettings: (slug: string, body: EmailSettingsInput) =>
    api<EmailSettings>(admin(slug, "/email"), { method: "PUT", body }),
  testEmailSettings: (slug: string) =>
    api<EmailTestResponse>(admin(slug, "/email/test"), { method: "POST", body: {} }),
  registerEmailDomain: (slug: string, body: EmailDomainInput) =>
    api<EmailSettings>(admin(slug, "/email/domain"), { method: "PUT", body }),
  verifyEmailDomain: (slug: string) =>
    api<EmailSettings>(admin(slug, "/email/domain/verify"), { method: "POST", body: {} }),
  removeEmailDomain: (slug: string) =>
    api<EmailSettings>(admin(slug, "/email/domain"), { method: "DELETE" }),
  activateEmail: (slug: string) =>
    api<EmailSettings>(admin(slug, "/email/activate"), { method: "POST", body: {} }),
  deactivateEmail: (slug: string) =>
    api<EmailSettings>(admin(slug, "/email/deactivate"), { method: "POST", body: {} }),
  orgChart: (
    slug: string,
    query: { parent: string; cursor?: string | undefined; pageSize: number; preview: number },
    signal?: AbortSignal,
  ) =>
    api<OrgChart>(admin(slug, `/members/org-chart?${listQuery(query)}`), signal ? { signal } : {}),
  orgChartSearch: (slug: string, q: string, signal?: AbortSignal) =>
    api<{ hits: OrgSearchHit[] }>(
      admin(slug, `/members/org-chart/search?${listQuery({ q })}`),
      signal ? { signal } : {},
    ),
  members: (slug: string, query: MemberQuery, signal?: AbortSignal) =>
    api<MemberList>(admin(slug, `/members?${queryString(query)}`), signal ? { signal } : {}),
  exportMembers: (slug: string, query: MemberQuery) => {
    const params = new URLSearchParams(queryString(query));
    params.delete("page");
    params.delete("pageSize");
    return api<{ filename: string; csv: string; rows: number }>(
      admin(slug, `/members/export?${params.toString()}`),
    );
  },
  updateMember: (
    slug: string,
    id: string,
    body: {
      roleId?: string;
      seatType?: SeatType;
      departmentIds?: string[];
      jobTitle?: string | null;
      name?: string;
      email?: string;
    },
  ) => api<{ member: MemberView }>(admin(slug, `/members/${id}`), { method: "PATCH", body }),
  suspendMember: (slug: string, id: string) =>
    api<{ member: MemberView }>(admin(slug, `/members/${id}/suspend`), { method: "POST" }),
  reactivateMember: (slug: string, id: string) =>
    api<{ member: MemberView }>(admin(slug, `/members/${id}/reactivate`), { method: "POST" }),
  removeMember: (slug: string, id: string) =>
    api<undefined>(admin(slug, `/members/${id}`), { method: "DELETE" }),
  resetTwoFactor: (slug: string, id: string) =>
    api<undefined>(admin(slug, `/members/${id}/2fa/reset`), { method: "POST" }),
  revokeSessions: (slug: string, id: string) =>
    api<{ revoked: number }>(admin(slug, `/members/${id}/revoke-sessions`), { method: "POST" }),
  bulk: (slug: string, ids: string[], action: BulkAction) =>
    api<BulkResult>(admin(slug, "/members/bulk"), { method: "POST", body: { ids, action } }),
  previewImport: (slug: string, csv: string) =>
    api<ImportPreview>(admin(slug, "/members/import"), { method: "POST", body: { csv } }),
  confirmImport: (slug: string, csv: string) =>
    api<ImportPreview & { invited: number }>(admin(slug, "/members/import/confirm"), {
      method: "POST",
      body: { csv },
    }),

  invitations: (slug: string, query: InvitationQuery) =>
    api<Page<InvitationView>>(admin(slug, `/invitations?${listQuery({ ...query })}`)),
  invite: (
    slug: string,
    body: { emails: string[]; roleId: string; seatType?: SeatType; departmentIds: string[] },
  ) =>
    api<{ invitations: InvitationView[]; skipped: { email: string; reason: string }[] }>(
      admin(slug, "/invitations"),
      { method: "POST", body },
    ),
  revokeInvitation: (slug: string, id: string) =>
    api<undefined>(admin(slug, `/invitations/${id}`), { method: "DELETE" }),
  resendInvitation: (slug: string, id: string) =>
    api<{ invitation: InvitationView }>(admin(slug, `/invitations/${id}/resend`), {
      method: "POST",
    }),
  seats: (slug: string) => api<{ seats: Seats }>(admin(slug, "/seats")),

  roles: (slug: string, query: RoleQuery) =>
    api<Page<RoleView>>(admin(slug, `/roles?${listQuery({ ...query })}`)),
  /** Para los combobox: búsqueda y páginas; con `ids`, solo esos (lo ya elegido). */
  roleOptions: (slug: string, query: OptionsQuery, signal?: AbortSignal) =>
    api<Page<RoleView>>(
      admin(slug, `/roles/options?${optionsQueryString(query)}`),
      signal ? { signal } : {},
    ),
  capabilities: (slug: string) => api<CapabilityInfo>(admin(slug, "/capabilities")),
  createRole: (
    slug: string,
    body: { name: string; description?: string | null; base: SystemRole; capabilities: string[] },
  ) => api<{ role: RoleView }>(admin(slug, "/roles"), { method: "POST", body }),
  updateRole: (
    slug: string,
    id: string,
    body: {
      name?: string;
      description?: string | null;
      base?: SystemRole;
      capabilities?: string[];
    },
  ) => api<{ role: RoleView }>(admin(slug, `/roles/${id}`), { method: "PATCH", body }),
  deleteRole: (slug: string, id: string) =>
    api<undefined>(admin(slug, `/roles/${id}`), { method: "DELETE" }),

  departments: (slug: string, query: DepartmentQuery) =>
    api<Page<DepartmentView>>(admin(slug, `/departments?${listQuery({ ...query })}`)),
  /** Para los combobox: búsqueda y páginas; con `ids`, solo esos (lo ya elegido). */
  departmentOptions: (slug: string, query: OptionsQuery, signal?: AbortSignal) =>
    api<Page<DepartmentOptionView>>(
      admin(slug, `/departments/options?${optionsQueryString(query)}`),
      signal ? { signal } : {},
    ),
  department: (slug: string, id: string) =>
    api<{ department: DepartmentView; ancestors: { id: string; name: string }[] }>(
      admin(slug, `/departments/${id}`),
    ),
  /** Directorio de personas: lo que cada uno puede ver (jefes incluidos), para elegir a quién sumar. */
  directory: (
    slug: string,
    query: { q?: string; cursor?: string | undefined; pageSize?: number },
    signal?: AbortSignal,
  ) =>
    api<Page<DirectoryEntry>>(
      `/w/${slug}/directory?${listQuery({ ...query })}`,
      signal ? { signal } : {},
    ),
  /**
   * Personas de un departamento para el "Ver más" del organigrama, según lo que quien mira puede
   * ver (directorio). `none` = sin departamento.
   */
  orgMembers: async (
    slug: string,
    departmentId: string,
    query: {
      q?: string;
      cursor?: string | undefined;
      pageSize: number;
      positions?: "leaders" | "members";
    },
  ): Promise<Page<PersonData>> => {
    const page = await api<Page<OrgPersonView>>(
      `/w/${slug}/directory/departments/${departmentId}/members?${listQuery({ ...query })}`,
    );
    return { ...page, items: page.items.map(asPerson) };
  },
  departmentMembers: (
    slug: string,
    id: string,
    query: {
      q?: string;
      page?: number;
      cursor?: string | undefined;
      pageSize: number;
      /** "leaders" (jefe y subjefes), "members" (sin cargo) o todos. */
      positions?: "leaders" | "members";
    },
  ) => api<Page<MemberView>>(admin(slug, `/departments/${id}/members?${listQuery({ ...query })}`)),
  /** Nombra o releva a jefe, subjefe o miembro;. */
  setDepartmentPosition: (
    slug: string,
    id: string,
    membershipId: string,
    body: { position: DepartmentPosition },
  ) =>
    api<{ department: DepartmentView; needsFullSeat: boolean }>(
      admin(slug, `/departments/${id}/members/${membershipId}/position`),
      { method: "PUT", body },
    ),
  moveDepartmentMember: (slug: string, id: string, membershipId: string, toDepartmentId: string) =>
    api<undefined>(admin(slug, `/departments/${id}/members/${membershipId}/move`), {
      method: "POST",
      body: { toDepartmentId },
    }),
  departmentAccess: (slug: string, id: string) =>
    api<{ spaces: unknown[]; folders: unknown[]; documents: unknown[] }>(
      admin(slug, `/departments/${id}/access`),
    ),
  createDepartment: (
    slug: string,
    body: {
      name: string;
      description?: string | null;
      color?: string | null;
      parentId?: string | null;
      headId?: string | null;
    },
  ) => api<{ department: DepartmentView }>(admin(slug, "/departments"), { method: "POST", body }),
  updateDepartment: (
    slug: string,
    id: string,
    body: {
      name?: string;
      description?: string | null;
      color?: string | null;
      parentId?: string | null;
      headId?: string | null;
    },
  ) =>
    api<{ department: DepartmentView; needsFullSeat: boolean }>(admin(slug, `/departments/${id}`), {
      method: "PATCH",
      body,
    }),
  deleteDepartment: (slug: string, id: string) =>
    api<undefined>(admin(slug, `/departments/${id}`), { method: "DELETE" }),
  addDepartmentMembers: (slug: string, id: string, membershipIds: string[]) =>
    api<{ added: number }>(admin(slug, `/departments/${id}/members`), {
      method: "POST",
      body: { membershipIds },
    }),
  removeDepartmentMember: (slug: string, id: string, membershipId: string) =>
    api<undefined>(admin(slug, `/departments/${id}/members/${membershipId}`), {
      method: "DELETE",
    }),
};
