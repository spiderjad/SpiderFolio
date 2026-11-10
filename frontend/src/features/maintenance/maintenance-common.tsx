// What the maintenance module's screens share (docs/spec/mantenimiento.md): who can do what, the guard
// (404 with the module off), the badges and the pickers of equipment and technicians.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Navigate, Outlet, useParams } from "react-router";
import { useStaticSource, type ComboboxSource } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/display";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import {
  maintenanceApi,
  maintenanceKeys,
  type Asset,
  type Priority,
  type WorkStatus,
} from "./maintenance-api";
import { texts } from "@/i18n";

const t = texts.maintenance;

export function useMaintenance() {
  const membership = useMembership();
  const caps = membership.capabilities;
  const manage = caps.includes("maintenance.manage");
  const work = manage || caps.includes("maintenance.work");
  const view = work || caps.includes("maintenance.view");
  // Readers and user + PIN accounts report too (shared tablets in the plant): only guests don't.
  const report = membership.role.base !== "GUEST";
  return { enabled: membership.workspace.maintenance.enabled, manage, work, view, report };
}

export function RequireMaintenance() {
  const { enabled, view, report } = useMaintenance();
  return enabled && (view || report) ? <Outlet /> : <NotFoundPage />;
}

/** /mantenimiento opens on the open work orders (maintenance) or on reporting (everyone else). */
export function MaintenanceHome() {
  const { workspaceSlug = "" } = useParams();
  const { view } = useMaintenance();
  return (
    <Navigate
      replace
      to={`/app/${workspaceSlug}/mantenimiento/${view ? "ot?estado=open" : "avisar"}`}
    />
  );
}

const statusTone = {
  REPORTED: "warning",
  PLANNED: "primary",
  IN_PROGRESS: "primary",
  ON_HOLD: "warning",
  DONE: "success",
  CLOSED: "neutral",
  CANCELLED: "neutral",
} as const;

export function StatusBadge({ status }: { status: WorkStatus }) {
  return <Badge tone={statusTone[status]}>{t.statuses[status]}</Badge>;
}

const priorityTone = {
  URGENT: "danger",
  HIGH: "warning",
  NORMAL: "neutral",
  LOW: "neutral",
} as const;

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={priorityTone[priority]}>{t.priorities[priority]}</Badge>;
}

export function useAssets(archived = false) {
  const { workspaceSlug = "" } = useParams();
  return useQuery({
    queryKey: maintenanceKeys.assets(workspaceSlug, archived),
    queryFn: () => maintenanceApi.assets(workspaceSlug, archived),
    select: (data) => data.assets,
  });
}

/** «EMB-02 · Embutidora 2», with the line above it when it has one. */
export function assetLabel(asset: Asset, all: readonly Asset[]): string {
  const parent = asset.parentId === null ? undefined : all.find((a) => a.id === asset.parentId);
  return `${asset.code} · ${asset.name}${parent === undefined ? "" : ` (${parent.name})`}`;
}

export function useAssetSource(key: string, assets: readonly Asset[]): ComboboxSource {
  return useStaticSource(
    `maintenance-assets-${key}`,
    assets.map((asset) => ({ id: asset.id, label: assetLabel(asset, assets) })),
  );
}

export function useTechnicianSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  const technicians = useQuery({
    queryKey: maintenanceKeys.technicians(workspaceSlug),
    queryFn: () => maintenanceApi.technicians(workspaceSlug),
    select: (data) => data.technicians,
    staleTime: 60_000,
  });
  const options = useMemo(
    () => (technicians.data ?? []).map((person) => ({ id: person.id, label: person.name })),
    [technicians.data],
  );
  return useStaticSource("maintenance-technicians", options);
}

/** Today in the browser, «YYYY-MM-DD». */
export const todayDay = (): string => {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
