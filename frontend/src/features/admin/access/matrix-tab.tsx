// Matriz de accesos: qué nivel tiene cada departamento en cada espacio (en jerarquía, con las
// subáreas indentadas). Una celda puede ser un nivel, «—» (sin acceso) o «Parcial · N elementos»
// (solo carpetas o archivos compartidos dentro del espacio). Un clic abre el detalle de la celda.
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { LoadMore, ShownCounter } from "@/components/ui/infinite";
import { Sheet, SheetContent } from "@/components/ui/overlay";
import type { AccessLevel } from "@/features/files/api";
import { NodeIcon } from "@/features/files/file-utils";
import { reasonText } from "@/features/sharing/reasons";
import { cn, formatShortDate } from "@/lib/utils";
import { useListParams, useSearchParam } from "../list-params";
import { accessAuditApi, accessAuditKeys } from "./access-api";
import { texts } from "@/i18n";

const LEVEL_STYLE: Record<AccessLevel, string> = {
  MANAGE: "bg-primary text-primary-foreground",
  EDIT: "bg-success-soft text-success-soft-foreground",
  COMMENT: "bg-warning-soft text-warning-soft-foreground",
  VIEW: "bg-muted text-muted-foreground",
};
const PARTIAL_STYLE =
  "border border-dashed border-primary/50 bg-primary-soft/40 text-primary-soft-foreground";
const LEVELS: readonly AccessLevel[] = ["MANAGE", "EDIT", "COMMENT", "VIEW"];

/** «Editar · jefe gestiona»: lo que tiene un miembro y, si es distinto, lo que tiene quien jefa. */
function cellLabel(level: AccessLevel | null, leaderLevel: AccessLevel | null): string {
  const t = texts.accessAudit;
  if (level === null)
    return leaderLevel === null ? "—" : t.matrix.leaderOnly(t.levelLead[leaderLevel]);
  if (leaderLevel === null || leaderLevel === level) return t.levelShort[level];
  return `${t.levelShort[level]} · ${t.matrix.leader(t.levelLead[leaderLevel])}`;
}

/** La celda abierta en el panel lateral. */
interface OpenCell {
  department: { id: string; name: string };
  space: { id: string; name: string };
}

export function MatrixTab() {
  const t = texts.accessAudit.matrix;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const [search, setSearch] = useSearchParam("q", params.get("q") ?? "", patch);
  const [open, setOpen] = useState<OpenCell | null>(null);
  // Columnas: una página de espacios a la vez; se avanza con su cursor y se vuelve con la pila.
  const [spaceCursors, setSpaceCursors] = useState<(string | undefined)[]>([undefined]);
  const spaceCursor = spaceCursors.at(-1);
  const q = params.get("q") ?? "";
  const query = useInfiniteQuery({
    queryKey: [...accessAuditKeys.all(workspaceSlug), "matrix", q, spaceCursor ?? ""],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      accessAuditApi.matrix(
        workspaceSlug,
        {
          q,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          ...(spaceCursor === undefined ? {} : { spaceCursor }),
        },
        signal,
      ),
    getNextPageParam: (last) => last.departments.nextCursor ?? undefined,
  });
  const data = query.data;
  const spaces = data?.pages[0]?.spaces;
  const departments = useMemo(() => data?.pages.flatMap((p) => p.departments.items) ?? [], [data]);
  const cells = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["pages"][number]["cells"][number]>();
    for (const page of data?.pages ?? []) {
      for (const cell of page.cells) map.set(`${cell.departmentId}:${cell.spaceId}`, cell);
    }
    return map;
  }, [data]);
  const partials = useMemo(() => {
    const map = new Map<string, number>();
    for (const page of data?.pages ?? []) {
      for (const partial of page.partials) {
        map.set(`${partial.departmentId}:${partial.spaceId}`, partial.count);
      }
    }
    return map;
  }, [data]);
  const names = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  return (
    <Card className="grid gap-3 p-4">
      <p className="text-xs text-muted-foreground">{t.description}</p>
      <ul
        aria-label={t.legend}
        className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-xs"
      >
        {LEVELS.map((level) => (
          <li key={level} className={cn("rounded-md px-2 py-0.5 font-medium", LEVEL_STYLE[level])}>
            {texts.accessAudit.levelShort[level]}
          </li>
        ))}
        <li className={cn("rounded-md px-2 py-0.5 font-medium", PARTIAL_STYLE)}>
          {t.partialLegend}
        </li>
        <li className="rounded-md px-2 py-0.5 text-muted-foreground">— {t.none}</li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t.search}
          label={t.search}
          className="max-w-xs"
        />
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={spaceCursors.length <= 1}
            onClick={() => {
              setSpaceCursors((stack) => stack.slice(0, -1));
            }}
          >
            <ChevronLeft strokeWidth={1.75} aria-hidden="true" />
            {t.previousSpaces}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={spaces?.nextCursor === null || spaces === undefined}
            onClick={() => {
              const next = spaces?.nextCursor;
              if (next !== null && next !== undefined) setSpaceCursors((stack) => [...stack, next]);
            }}
          >
            {t.moreSpaces}
            <ChevronRight strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {texts.accessAudit.loadError}
        </p>
      ) : spaces === undefined || spaces.items.length === 0 ? (
        <EmptyState icon={ScanSearch}>{t.noSpaces}</EmptyState>
      ) : departments.length === 0 ? (
        <EmptyState icon={ScanSearch}>{t.empty}</EmptyState>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th scope="col" className="sticky left-0 bg-muted p-2 text-left font-medium">
                  {t.department}
                </th>
                {spaces.items.map((space) => (
                  <th key={space.id} scope="col" className="min-w-32 p-2 text-left font-medium">
                    <span className="block truncate">{space.name}</span>
                    {(space.isConfidential || space.isPrivate) && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {space.isConfidential ? t.confidential : t.private}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => (
                <tr key={department.id} className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 bg-background p-2 text-left font-medium"
                    style={{ paddingLeft: `${String(8 + department.depth * 16)}px` }}
                  >
                    {department.depth > 0 && (
                      <span className="mr-1 text-muted-foreground" aria-hidden="true">
                        ↳
                      </span>
                    )}
                    {department.name}
                  </th>
                  {spaces.items.map((space) => {
                    const key = `${department.id}:${space.id}`;
                    const cell = cells.get(key);
                    const partial = partials.get(key);
                    const shown = cell === undefined ? null : (cell.level ?? cell.leaderLevel);
                    const why =
                      cell?.reason === undefined || cell.reason === null
                        ? ""
                        : reasonText(
                            cell.reason,
                            "departmentId" in cell.reason &&
                              typeof cell.reason.departmentId === "string"
                              ? (names.get(cell.reason.departmentId) ?? null)
                              : null,
                          );
                    const label =
                      cell !== undefined
                        ? cellLabel(cell.level, cell.leaderLevel)
                        : partial !== undefined
                          ? t.partial(partial)
                          : "—";
                    return (
                      <td key={space.id} className="p-1.5">
                        <button
                          type="button"
                          title={
                            cell === undefined
                              ? undefined
                              : t.cell(department.name, space.name, label, why)
                          }
                          aria-label={`${department.name} · ${space.name}: ${label}`}
                          onClick={() => {
                            setOpen({
                              department: { id: department.id, name: department.name },
                              space: { id: space.id, name: space.name },
                            });
                          }}
                          className={cn(
                            "inline-block cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                            shown !== null
                              ? LEVEL_STYLE[shown]
                              : partial !== undefined
                                ? PARTIAL_STYLE
                                : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore
            hasNextPage={query.hasNextPage}
            isFetching={query.isFetchingNextPage}
            onLoadMore={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
            }}
          />
        </div>
      )}
      <ShownCounter
        shown={departments.length}
        total={data?.pages.at(-1)?.departments.total ?? 0}
        className="static border-t-0 px-0"
      />
      <Sheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        {open !== null && (
          <SheetContent
            title={t.detail.title(open.department.name, open.space.name)}
            className="left-auto right-0 w-[460px] max-w-[95vw]"
          >
            <CellDetail cell={open} />
          </SheetContent>
        )}
      </Sheet>
    </Card>
  );
}

function CellDetail({ cell }: { cell: OpenCell }) {
  const t = texts.accessAudit.matrix.detail;
  const { workspaceSlug = "" } = useParams();
  const query = useInfiniteQuery({
    queryKey: [...accessAuditKeys.all(workspaceSlug), "cell", cell.department.id, cell.space.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      accessAuditApi.matrixCell(
        workspaceSlug,
        { departmentId: cell.department.id, spaceId: cell.space.id },
        pageParam,
        signal,
      ),
    getNextPageParam: (last) => last.items.nextCursor ?? undefined,
  });
  const first = query.data?.pages[0];
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items.items) ?? [], [query.data]);
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5 pr-12">
      <div>
        <h2 className="text-lg font-semibold">{t.title(cell.department.name, cell.space.name)}</h2>
      </div>
      {query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError || first === undefined ? (
        <p role="alert" className="text-sm text-danger">
          {texts.accessAudit.loadError}
        </p>
      ) : (
        <>
          <section className="grid gap-1.5">
            <h3 className="text-sm font-semibold">{t.spaceAccess}</h3>
            {first.spaceAccess === null ? (
              <p className="text-xs text-muted-foreground">{t.noSpaceAccess}</p>
            ) : (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {first.spaceAccess.reasons.map((reason, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <Badge>{texts.accessAudit.levelShort[reason.level]}</Badge>
                    <span className="text-muted-foreground">
                      {reasonText(reason.reason, reason.departmentName)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-1.5">
            <h3 className="text-sm font-semibold">{t.items}</h3>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t.noItems}</p>
            ) : (
              <ul className="m-0 grid list-none divide-y divide-border p-0">
                {items.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 py-2">
                    <NodeIcon node={item.node} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={
                          item.node.type === "PAGE"
                            ? `/app/${workspaceSlug}/files/${cell.space.id}/p/${item.node.id}`
                            : `/app/${workspaceSlug}/files/${cell.space.id}/f/${item.node.id}`
                        }
                        aria-label={t.open(item.node.name)}
                        className="block truncate text-sm font-medium hover:underline focus-visible:outline-none focus-visible:underline"
                      >
                        {item.node.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[
                          item.via.inherited
                            ? t.viaParent(item.via.departmentName)
                            : t.via(item.via.departmentName),
                          item.sharedBy === null ? null : t.by(item.sharedBy),
                          t.on(formatShortDate(item.sharedAt)),
                          item.expiresAt === null
                            ? null
                            : t.expires(formatShortDate(item.expiresAt)),
                        ]
                          .filter((part) => part !== null)
                          .join(" · ")}
                      </p>
                    </div>
                    <Badge>{texts.accessAudit.levelShort[item.level]}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <LoadMore
              hasNextPage={query.hasNextPage}
              isFetching={query.isFetchingNextPage}
              onLoadMore={() => {
                if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}
