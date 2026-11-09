// What the environment module's screens share (docs/spec/medio-ambiente.md): the guard (404 with the
// module off or without its capabilities), who can do what, the due-date text and the people picker.
import { useMemo } from "react";
import { Link, Navigate, Outlet, useParams } from "react-router";
import { COMBO_PAGE_SIZE, type ComboboxSource } from "@/components/ui/combobox";
import { adminApi } from "@/features/admin/api";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import { formatUtcDate } from "@/lib/utils";
import type { FolderRef } from "./environment-api";
import { texts } from "@/i18n";

const c = texts.environment.common;

export function useEnvironment() {
  const membership = useMembership();
  const caps = membership.capabilities;
  const manage = caps.includes("environment.manage");
  const view = manage || caps.includes("environment.view");
  const record = manage || caps.includes("environment.record");
  return { enabled: membership.workspace.environment.enabled, manage, view, record };
}

/** The module's screens: only with it on and some environment capability. */
export function RequireEnvironment() {
  const { enabled, view, record } = useEnvironment();
  return enabled && (view || record) ? <Outlet /> : <NotFoundPage />;
}

/** /medio-ambiente opens where the person can work: permits (view) or the waste collections. */
export function EnvironmentHome() {
  const { workspaceSlug = "" } = useParams();
  const { view } = useEnvironment();
  return (
    <Navigate
      replace
      to={`/app/${workspaceSlug}/medio-ambiente/${view ? "resumen" : "residuos"}`}
    />
  );
}

/** Days from today (the browser's day) to «YYYY-MM-DD»; negative once it's past. */
export function daysTo(day: string): number {
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(`${day}T00:00:00Z`) - start) / 86_400_000);
}

/** A date with how soon it's due: red when past or within a week, amber within the warning window. */
export function DueDate({ day, warnDays = 60 }: { day: string | null; warnDays?: number }) {
  if (day === null) return <span className="text-muted-foreground">{c.none}</span>;
  const days = daysTo(day);
  return (
    <div className="grid gap-0.5">
      <span className="whitespace-nowrap tabular-nums">{formatUtcDate(day)}</span>
      {days < 0 ? (
        <span className="text-xs text-danger">{c.expired}</span>
      ) : days <= warnDays ? (
        <span
          className={days <= 7 ? "text-xs text-danger" : "text-xs text-warning-soft-foreground"}
        >
          {c.dueIn(days)}
        </span>
      ) : null}
    </div>
  );
}

/** A link to the documents folder of a permit or a company. */
export function FolderLink({ folder }: { folder: FolderRef | null }) {
  const { workspaceSlug = "" } = useParams();
  if (folder === null) return null;
  return (
    <Link
      to={`/app/${workspaceSlug}/files/${folder.spaceId}/f/${folder.id}`}
      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
    >
      {c.documents}
    </Link>
  );
}

/** The company's active people (the directory every member sees). */
export function usePeopleSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "environment", "people-options"],
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

/** «" "» → null, for optional fields. */
export const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());
