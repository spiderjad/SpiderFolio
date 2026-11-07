// What every screen of the occupational health and safety module shares (docs/spec/seguridad-salud.md):
// the company's terms (EPI or EPP), who manages it, the guard that hides it while it's off and the
// header with its tabs.
import { useQuery } from "@tanstack/react-query";
import { Siren } from "lucide-react";
import { useMemo } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import type { ComboboxSource } from "@/components/ui/combobox";
import { COMBO_PAGE_SIZE } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/display";
import { adminApi } from "@/features/admin/api";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import { cn } from "@/lib/utils";
import { useCae, usePendingCount } from "./cae-common";
import {
  incidentsApi,
  incidentsKeys,
  safetyApi,
  safetyKeys,
  type IncidentStatus,
  type PpeState,
} from "./safety-api";
import { texts } from "@/i18n";

export function useSafety() {
  const membership = useMembership();
  const { enabled, terms } = membership.workspace.safety;
  return {
    enabled,
    terms: texts.safety.terms[terms],
    /** The country's terms: es (Spain) or latam. */
    termsKey: terms,
    canManage: membership.capabilities.includes("safety.manage"),
    /** Health data (accidents, fitness): safety.health. */
    health: membership.capabilities.includes("safety.health"),
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
  const { slug, canManage, health, leads, membershipId } = useSafety();
  const cae = useCae();
  const base = `/app/${slug}/seguridad`;
  // Whoever only checks contractors (the gatehouse) starts at the gate.
  if (cae.visible && !cae.manage && !canManage && !health && !leads) {
    return <Navigate replace to={`${cae.base}/porteria`} />;
  }
  return (
    <Navigate
      replace
      to={
        canManage || health
          ? `${base}/resumen`
          : leads
            ? `${base}/personas`
            : `${base}/personas/${membershipId}`
      }
    />
  );
}

/** Accidents and incidents: health data. */
export function RequireSafetyHealth() {
  const { health } = useSafety();
  return health ? <Outlet /> : <NotFoundPage />;
}

/** Opens the base form to report an accident, an incident or a near miss (everyone). */
export function ReportIncidentButton() {
  const { slug } = useSafety();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useQuery({
    queryKey: incidentsKeys.form(slug),
    queryFn: () => incidentsApi.form(slug),
    select: (data) => data.form,
  });
  if (form.data == null) return null;
  return (
    <Button
      variant="outline"
      onClick={() => {
        void navigate(`/app/${slug}/seguridad/comunicar`, {
          state: { from: `${location.pathname}${location.search}` },
        });
      }}
    >
      <Siren className="size-4" aria-hidden="true" />
      {texts.safety.incidents.report}
    </Button>
  );
}

/** The module's screens for whoever manages it. */
export function RequireSafetyManager() {
  const { canManage } = useSafety();
  return canManage ? <Outlet /> : <NotFoundPage />;
}

export function PpeTabs() {
  const { slug, canManage, health, leads } = useSafety();
  const cae = useCae();
  const caePending = usePendingCount();
  // Only for whoever manages the module (or its health data), the heads and whoever checks
  // contractors (CAE): the rest go to their sheet.
  if (!canManage && !health && !leads && !cae.visible) return null;
  // Whoever only checks contractors sees only CAE: their own sheet stays at «Mi ficha» in their profile.
  const safetyTabs = canManage || health || leads;
  const t = texts.safety.tabs;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
      isActive
        ? "border-primary font-medium text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );
  const base = `/app/${slug}/seguridad`;
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border">
      {(canManage || health) && (
        <NavLink end to={`${base}/resumen`} className={tab}>
          {texts.safety.summary.tab}
        </NavLink>
      )}
      {safetyTabs && (
        <>
          <NavLink end to={`${base}/personas`} className={tab}>
            {texts.safety.people.tab}
          </NavLink>
          <NavLink end to={`${base}/epis`} className={tab}>
            {t.deliveries}
          </NavLink>
        </>
      )}
      {canManage && (
        <NavLink to={`${base}/epis/catalogo`} className={tab}>
          {t.catalog}
        </NavLink>
      )}
      {safetyTabs && (
        <NavLink to={`${base}/formacion`} className={tab}>
          {texts.safety.training.tab}
        </NavLink>
      )}
      {canManage && (
        <NavLink to={`${base}/planificacion`} className={tab}>
          {texts.safety.planning.tab}
        </NavLink>
      )}
      {(canManage || health) && (
        <NavLink to={`${base}/indicadores`} className={tab}>
          {texts.safety.indicators.tab}
        </NavLink>
      )}
      {health && (
        <NavLink to={`${base}/incidentes`} className={tab}>
          {texts.safety.incidents.tab}
        </NavLink>
      )}
      {cae.visible && (
        <NavLink to={cae.base} className={tab}>
          {cae.terms.tab}
          {caePending > 0 && (
            <Badge tone="primary" className="ml-1.5" aria-label={texts.cae.review.tab(caePending)}>
              {caePending}
            </Badge>
          )}
        </NavLink>
      )}
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

/** A case's state: amber while open, blue while under investigation, green once closed. */
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const i = texts.safety.incidents;
  return status === "OPEN" ? (
    <Badge tone="warning">{i.open}</Badge>
  ) : status === "INVESTIGATING" ? (
    <Badge tone="primary">{i.investigating}</Badge>
  ) : (
    <Badge tone="success">{i.closed}</Badge>
  );
}
