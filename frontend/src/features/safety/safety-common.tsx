// What every screen of the occupational health and safety module shares (docs/spec/seguridad-salud.md):
// the company's terms (EPI or EPP), who manages it, the guard that hides it while it's off and the
// header with its tabs.
import { useMemo } from "react";
import { Navigate, NavLink, Outlet, useParams } from "react-router";
import type { ComboboxSource } from "@/components/ui/combobox";
import { COMBO_PAGE_SIZE } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/display";
import { adminApi } from "@/features/admin/api";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import { cn } from "@/lib/utils";
import { safetyApi, safetyKeys, type PpeState } from "./safety-api";
import { texts } from "@/i18n";

export function useSafety() {
  const membership = useMembership();
  const { enabled, terms } = membership.workspace.safety;
  return {
    enabled,
    terms: texts.safety.terms[terms],
    canManage: membership.capabilities.includes("safety.manage"),
    /** Heads and deputies see their area's PPE. */
    leads: membership.leadsDepartments,
    membershipId: membership.id,
    slug: membership.workspace.slug,
  };
}

/** The module's screens exist only while it's on. */
export function RequireSafety() {
  const { enabled } = useSafety();
  return enabled ? <Outlet /> : <NotFoundPage />;
}

/** The module's start: the handouts for whoever sees others', their own PPE for everyone else. */
export function SafetyHome() {
  const { slug, canManage, leads, membershipId } = useSafety();
  return (
    <Navigate
      replace
      to={
        canManage || leads
          ? `/app/${slug}/seguridad/epis`
          : `/app/${slug}/seguridad/personas/${membershipId}`
      }
    />
  );
}

/** The module's screens for whoever manages it. */
export function RequireSafetyManager() {
  const { canManage } = useSafety();
  return canManage ? <Outlet /> : <NotFoundPage />;
}

export function PpeTabs() {
  const { slug, canManage } = useSafety();
  if (!canManage) return null;
  const t = texts.safety.tabs;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
      isActive
        ? "border-primary font-medium text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );
  return (
    <nav className="flex gap-1 border-b border-border">
      <NavLink end to={`/app/${slug}/seguridad/epis`} className={tab}>
        {t.deliveries}
      </NavLink>
      <NavLink to={`/app/${slug}/seguridad/epis/catalogo`} className={tab}>
        {t.catalog}
      </NavLink>
    </nav>
  );
}

const stateTone = { valid: "success", due_soon: "warning", expired: "danger" } as const;

export function PpeStateBadge({ state }: { state: PpeState }) {
  return <Badge tone={stateTone[state]}>{texts.safety.person.states[state]}</Badge>;
}

/** The company's people (the directory), for choosing who receives a handout or filtering. */
export function usePeopleSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "safety", "people-options"],
      search: async (q, cursor, signal) => {
        const page = await adminApi.directory(
          workspaceSlug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((person) => ({ id: person.id, label: person.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
}

/** The catalog's active items. */
export function useItemSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...safetyKeys.items(workspaceSlug), "options"],
      search: async (q, cursor, signal) => {
        const page = await safetyApi.items(
          workspaceSlug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((item) => ({
            id: item.id,
            label: item.name,
            ...(item.category === null ? {} : { description: item.category }),
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: async (ids) =>
        (await safetyApi.items(workspaceSlug, { ids, status: "all" })).items.map((item) => ({
          id: item.id,
          label: item.name,
        })),
    }),
    [workspaceSlug],
  );
}
