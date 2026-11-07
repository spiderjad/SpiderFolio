// What every screen of the occupational health and safety module shares (docs/spec/seguridad-salud.md):
// the company's terms (EPI or EPP), who manages it and the guards that hide its screens. Its sections
// are listed in the Prevention area's menu (docs/spec/diseno.md 10.4.1), not in tabs.
import { useQuery } from "@tanstack/react-query";
import { Siren } from "lucide-react";
import { useMemo } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import type { ComboboxSource } from "@/components/ui/combobox";
import { COMBO_PAGE_SIZE } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/display";
import { adminApi } from "@/features/admin/api";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import { useCae } from "./cae-common";
import {
  committeeApi,
  committeeKeys,
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

/**
 * Whether the person sees the committee (docs/spec/seguridad-salud.md, «Consulta y participación»):
 * whoever manages the module, or a current member of the committee (asked to the server).
 */
export function useCommitteeAccess(): { visible: boolean; pending: boolean } {
  const { enabled, canManage, slug } = useSafety();
  const query = useQuery({
    queryKey: committeeKeys.access(slug),
    queryFn: () => committeeApi.access(slug),
    enabled: enabled && !canManage,
    staleTime: 60_000,
  });
  if (canManage) return { visible: true, pending: false };
  return { visible: query.data?.member === true, pending: enabled && query.isPending };
}

/** The committee's screens: for whoever manages the module and for the committee's members. */
export function RequireCommittee() {
  const { visible, pending } = useCommitteeAccess();
  if (pending) return null;
  return visible ? <Outlet /> : <NotFoundPage />;
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
