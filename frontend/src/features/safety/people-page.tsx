// /app/:slug/seguridad/personas — the module's people (docs/spec/seguridad-salud.md, «Ficha por persona»):
// whoever manages it sees everyone, heads their area; search, position and department in the address,
// and each one's alerts. Opens each person's sheet.
import type { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Combobox } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { useInfiniteList } from "@/components/ui/infinite";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { useDepartmentSource, usePositionSource } from "@/features/admin/sources";
import { peopleApi, safetyKeys, type PeopleFilters, type SafetyPersonRow } from "./safety-api";
import { PpeTabs } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.people;

export function PeoplePage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const filters = useMemo<PeopleFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      position: params.get("puesto") ?? undefined,
      department: params.get("departamento") ?? undefined,
    }),
    [params],
  );
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const positions = usePositionSource(workspaceSlug);
  const departments = useDepartmentSource(workspaceSlug);
  const list = useInfiniteList<SafetyPersonRow>({
    queryKey: [...safetyKeys.all(workspaceSlug), "people", filters],
    fetchPage: (cursor, signal) => peopleApi.list(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<SafetyPersonRow>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <Link
            to={`/app/${workspaceSlug}/seguridad/personas/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "position",
        header: t.columns.position,
        cell: ({ row }) => row.original.position?.name ?? "—",
      },
      {
        id: "departments",
        header: t.columns.departments,
        cell: ({ row }) =>
          row.original.departments.length === 0
            ? "—"
            : row.original.departments.map((department) => department.name).join(", "),
      },
      {
        id: "alerts",
        header: t.columns.alerts,
        cell: ({ row }) => {
          const { missingPpe, training, fitness } = row.original.alerts;
          if (missingPpe === 0 && training === 0 && fitness === null) {
            return <Badge tone="success">{t.ok}</Badge>;
          }
          return (
            <span className="flex flex-wrap gap-1">
              {missingPpe > 0 && <Badge tone="warning">{t.missingPpe(missingPpe)}</Badge>}
              {training > 0 && <Badge tone="danger">{t.training(training)}</Badge>}
              {fitness !== null && (
                <Badge tone={fitness === "expired" ? "danger" : "warning"}>
                  {t.fitness[fitness]}
                </Badge>
              )}
            </span>
          );
        },
      },
    ],
    [workspaceSlug],
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <PpeTabs />
      <div className="grid gap-3 sm:grid-cols-[1fr_220px_220px]">
        <SearchField
          placeholder={t.search}
          label={texts.admin.common.search}
          value={search}
          onChange={setSearch}
        />
        <Combobox
          compact
          clearable
          label={t.position}
          placeholder={t.anyPosition}
          source={positions}
          value={filters.position ?? null}
          onChange={(option) => {
            patch({ puesto: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          label={t.department}
          placeholder={t.anyDepartment}
          source={departments}
          value={filters.department ?? null}
          onChange={(option) => {
            patch({ departamento: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={t.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(person) => person.id}
            loading={list.query.isPending}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
          />
        </Card>
      )}
    </div>
  );
}
