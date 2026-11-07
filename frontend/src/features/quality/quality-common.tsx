// What every screen of the food quality module shares (docs/spec/calidad.md): who manages it, the guard
// that hides its screens while it's off and the badges of severity and status. Its sections are listed in
// the Quality area's menu (docs/spec/diseno.md 10.4.1).
import { useMemo } from "react";
import { Navigate, Outlet, useParams } from "react-router";
import type { ComboboxSource } from "@/components/ui/combobox";
import { COMBO_PAGE_SIZE } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/display";
import { adminApi } from "@/features/admin/api";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import type { NcStatus, Severity } from "./quality-api";
import { texts } from "@/i18n";

export function useQuality() {
  const membership = useMembership();
  const manage = membership.capabilities.includes("quality.manage");
  return {
    enabled: membership.workspace.quality.enabled,
    manage,
    /** Reads every nonconformity: quality.view (or manage). */
    view: manage || membership.capabilities.includes("quality.view"),
    guest: membership.role.base === "GUEST",
    membershipId: membership.id,
    slug: membership.workspace.slug,
  };
}

/** The module's screens exist only while it's on (and never for guests). */
export function RequireQuality() {
  const { enabled, guest } = useQuality();
  return enabled && !guest ? <Outlet /> : <NotFoundPage />;
}

/** The area's start: the summary for whoever sees every NC; the rest, their actions. */
export function QualityHome() {
  const { slug, view } = useQuality();
  const base = `/app/${slug}/calidad`;
  return <Navigate to={view ? `${base}/resumen` : `${base}/mis-acciones`} replace />;
}

const severityTone = { CRITICAL: "danger", MAJOR: "warning", MINOR: "neutral" } as const;

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={severityTone[severity]}>{texts.quality.severities[severity]}</Badge>;
}

const statusTone = {
  OPEN: "warning",
  ANALYSIS: "primary",
  ACTIONS: "primary",
  VERIFICATION: "warningSoft",
  CLOSED: "success",
  CANCELLED: "neutral",
} as const;

export function NcStatusBadge({ status }: { status: NcStatus }) {
  return <Badge tone={statusTone[status]}>{texts.quality.statuses[status]}</Badge>;
}

/** The company's active people (the directory every member sees). */
export function usePeopleSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "quality", "people-options"],
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

/** The company's departments, as a tree (for quality.manage). */
export function useDepartmentSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "quality", "department-options"],
      search: async (q, cursor, signal) => {
        const page = await adminApi.departmentOptions(
          workspaceSlug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((department) => ({
            id: department.id,
            label: department.name,
            depth: department.depth,
            path: department.path,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: async (ids) => {
        const page = await adminApi.departmentOptions(workspaceSlug, { ids });
        return page.items.map((department) => ({ id: department.id, label: department.name }));
      },
    }),
    [workspaceSlug],
  );
}

/** «YYYY-MM-DD» of today, in the browser's day. */
export function todayDay(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function inDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
