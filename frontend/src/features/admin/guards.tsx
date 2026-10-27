// Guarda de las secciones del panel: si la persona no tiene ninguna de las capacidades, la
// sección no existe para ella (misma pantalla que una ruta inexistente).
import { Outlet } from "react-router";
import { canSee, type adminSections } from "@/components/nav-items";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";

/** Capacidades de la persona en el workspace actual. */
export function useCapabilities(): readonly string[] {
  return useMembership().capabilities;
}

export function useCan(capability: string): boolean {
  return useCapabilities().includes(capability);
}

export function RequireCapability({ section }: { section: keyof typeof adminSections }) {
  return canSee(useMembership(), section) ? <Outlet /> : <NotFoundPage />;
}

// Una guarda por sección: así cada ruta del panel las carga con carga diferida.
export function RequireMembers() {
  return <RequireCapability section="members" />;
}

export function RequireDepartments() {
  return <RequireCapability section="departments" />;
}

export function RequireBian() {
  return <RequireCapability section="bian" />;
}

export function RequireLicense() {
  return <RequireCapability section="license" />;
}

export function RequireLimits() {
  return <RequireCapability section="limits" />;
}

export function RequireAudit() {
  return <RequireCapability section="audit" />;
}

export function RequireSecurity() {
  return <RequireCapability section="security" />;
}

/** Cambiar departamentos y cargos: administración, o jefe/subjefe en su área (lo acota el servidor). */
export function useCanEditPeople(): boolean {
  const manage = useCan("departments.manage");
  const own = useOwnScope();
  return manage || own;
}

/**
 * Alcance propio: jefe o subjefe (por cargo) sin rol de administración. Solo ve su departamento y
 * sus subáreas, y no las pantallas de toda la empresa (plazas, invitaciones de otras áreas). Lo
 * hace cumplir el servidor; esto solo evita pedir lo que va a negar.
 */
export function useOwnScope(): boolean {
  const { role, leadsDepartments } = useMembership();
  return role.base !== "OWNER" && role.base !== "ADMIN" && leadsDepartments;
}

export function RequireDocuments() {
  return <RequireCapability section="documents" />;
}

export function RequireAccess() {
  return <RequireCapability section="access" />;
}

export function RequireRoles() {
  return <RequireCapability section="roles" />;
}
