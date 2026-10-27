// Insignias de Miembros. El rol y el cargo se ven por separado: la insignia de rol (Propietario,
// Administrador, Miembro, Lector, Invitado) y, aparte, la de cargo en un departamento
// ("★ Jefe de X" en ámbar, "☆ Subjefe de X" en ámbar suave). El color nunca es lo único que
// distingue: cada una lleva ícono y texto.
import { Crown, Shield, Star, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/display";
import type { MemberView } from "../api";
import { texts } from "@/i18n";

export type RoleKind = "owner" | "admin" | "guest" | "reader" | "member";

/** Nombres de los roles de sistema: con otro nombre, el rol es personalizado y se muestra aparte. */
const SYSTEM_NAMES = new Set(["Propietario", "Administrador", "Miembro", "Invitado"]);

/** Qué insignia de rol le toca a una persona (la jefatura es otra insignia). */
export function roleKindOf(member: Pick<MemberView, "roleBase" | "seatType">): RoleKind {
  if (member.roleBase === "OWNER") return "owner";
  if (member.roleBase === "ADMIN") return "admin";
  if (member.roleBase === "GUEST") return "guest";
  return member.seatType === "READER" ? "reader" : "member";
}

const look: Record<RoleKind, { tone: "solid" | "primary" | "neutral"; icon?: LucideIcon }> = {
  owner: { tone: "solid", icon: Crown },
  admin: { tone: "primary", icon: Shield },
  guest: { tone: "neutral" },
  reader: { tone: "neutral" },
  member: { tone: "neutral" },
};

export function RoleBadge({ member }: { member: Pick<MemberView, "roleBase" | "seatType"> }) {
  const kind = roleKindOf(member);
  const { tone, icon: Icon } = look[kind];
  return (
    <Badge tone={tone} className="gap-1">
      {Icon !== undefined && <Icon className="size-3" strokeWidth={2} aria-hidden="true" />}
      {texts.admin.members.roleBadge[kind]}
    </Badge>
  );
}

/** Nombre del rol cuando es personalizado (el de sistema ya lo dice la insignia). */
export function customRoleName(member: { roleName: string | null }): string | null {
  return member.roleName === null || SYSTEM_NAMES.has(member.roleName) ? null : member.roleName;
}

/** Cargo en un departamento: "★ Jefe de X" (ámbar) o "☆ Subjefe de X" (ámbar suave). */
export function PositionBadge({
  position,
  departmentName,
}: {
  position: "HEAD" | "DEPUTY";
  departmentName: string;
}) {
  const t = texts.admin.members.position;
  const head = position === "HEAD";
  return (
    <Badge tone={head ? "warning" : "warningSoft"} className="gap-1">
      <Star
        className="size-3"
        strokeWidth={2}
        fill={head ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {head ? t.head(departmentName) : t.deputy(departmentName)}
    </Badge>
  );
}

/**
 * Los cargos de una persona. Con `departmentId` solo el de ese departamento (en los bloques por
 * departamento); sin él, todos (en la tabla).
 */
export function PositionBadges({
  member,
  departmentId,
}: {
  member: Pick<MemberView, "managedDepartments">;
  departmentId?: string;
}) {
  const shown =
    departmentId === undefined
      ? member.managedDepartments
      : member.managedDepartments.filter((d) => d.id === departmentId);
  return (
    <>
      {shown.map((d) => (
        <PositionBadge key={d.id} position={d.position} departmentName={d.name} />
      ))}
    </>
  );
}

/** Departamento de una persona; si tiene cargo, con la estrella: "IT · Jefe" o "IT · Subjefe". */
export function DepartmentChip({
  department,
}: {
  department: { id: string; name: string; position: "HEAD" | "DEPUTY" | "MEMBER" };
}) {
  const t = texts.admin.members.position;
  if (department.position === "MEMBER") return <Badge>{department.name}</Badge>;
  const head = department.position === "HEAD";
  return (
    <Badge tone={head ? "warning" : "warningSoft"} className="gap-1">
      <Star
        className="size-3"
        strokeWidth={2}
        fill={head ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {department.name} · {head ? t.headShort : t.deputyShort}
    </Badge>
  );
}

/** La jefatura de la persona: "Jefe o subjefe de Calidad". */
export function leadershipReason(member: Pick<MemberView, "managedDepartments">): string | null {
  if (member.managedDepartments.length === 0) return null;
  return texts.admin.members.leadership.of(member.managedDepartments.map((d) => d.name).join(", "));
}
