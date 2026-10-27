// /app/:slug/admin/access — Auditoría de accesos (docs/spec/panel-admin.md): matriz departamento ×
// espacio, «¿quién puede ver esto?» y «¿qué puede ver esta persona?», y reportes con CSV. Todo lo
// calcula el servidor con el mismo motor que decide el acceso; acá solo se muestra. La pestaña y los
// filtros viven en la URL.
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Download, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COMBO_PAGE_SIZE, Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { LoadMore, ShownCounter } from "@/components/ui/infinite";
import { adminApi } from "@/features/admin/api";
import { reasonLine, reasonText } from "@/features/sharing/reasons";
import { PersonRow } from "@/features/sharing/share-dialog";
import { formatShortDate } from "@/lib/utils";
import { adminErrorText, downloadTextFile } from "../admin-utils";
import { readChoice, useListParams, useSearchParam } from "../list-params";
import { MatrixTab } from "./matrix-tab";
import { SpacesTab } from "./spaces-tab";
import {
  accessAuditApi,
  accessAuditKeys,
  REPORT_KINDS,
  type PersonAccessReport,
  type ReportKind,
  type ReportRow,
} from "./access-api";
import { texts } from "@/i18n";

const TABS = ["spaces", "person", "advanced", "reports"] as const;

export function AccessPage() {
  const t = texts.accessAudit;
  const { params, patch } = useListParams();
  const tab = readChoice(params, "tab", TABS, "spaces");
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div role="tablist" aria-label={t.tabs.label} className="flex flex-wrap gap-1.5">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              patch({
                tab: value === "spaces" ? undefined : value,
                id: undefined,
                q: undefined,
                wq: undefined,
                k: undefined,
              });
            }}
            className="h-9 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:border-primary/30 aria-selected:bg-primary-soft aria-selected:font-medium aria-selected:text-primary-soft-foreground"
          >
            {t.tabs[value]}
          </button>
        ))}
      </div>
      {tab === "spaces" && <SpacesTab />}
      {tab === "person" && (
        <Card className="grid gap-4 p-4">
          <PersonPanel />
        </Card>
      )}
      {tab === "advanced" && (
        <>
          <MatrixTab />
          <Card className="grid gap-3 p-4">
            <h2 className="text-base font-semibold">{t.advancedWho}</h2>
            <WhoPanel />
          </Card>
        </>
      )}
      {tab === "reports" && <ReportsTab />}
    </div>
  );
}

// ─── Quién puede ver un espacio o un elemento ───────────────────────────────────────────

function WhoPanel() {
  const t = texts.accessAudit.search;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const kind = readChoice(params, "k", ["space", "node"] as const, "space");
  const id = params.get("id") ?? "";
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [search, setSearch] = useSearchParam("wq", params.get("wq") ?? "", patch);
  const q = params.get("wq") ?? "";

  const source = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "admin", "access", "targets", kind],
      search: async (text, cursor, signal) => {
        const page = await accessAuditApi.targets(workspaceSlug, kind, text, cursor, signal);
        return {
          items: page.items.map((o) => ({
            id: o.id,
            label: o.name,
            description: o.type === "node" ? t.inSpace(o.spaceName) : undefined,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug, kind, t],
  );
  const query = useInfiniteQuery({
    queryKey: [...accessAuditKeys.all(workspaceSlug), "who", kind, id, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      accessAuditApi.who(workspaceSlug, { type: kind, id }, q, pageParam, signal),
    getNextPageParam: (last) => last.people.nextCursor ?? undefined,
    enabled: id !== "",
  });
  const people = useMemo(
    () => query.data?.pages.flatMap((p) => p.people.items) ?? [],
    [query.data],
  );
  const name = query.data?.pages[0]?.target.name ?? label ?? "";
  const exportCsv = useMutation({
    mutationFn: async () => {
      downloadTextFile(
        `${name}.csv`,
        await accessAuditApi.whoCsv(workspaceSlug, { type: kind, id }),
      );
    },
    onSuccess: () => {
      toast.success(t.exported);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <select
          aria-label={t.kind.space}
          value={kind}
          onChange={(event) => {
            patch({
              k: event.target.value === "node" ? "node" : undefined,
              id: undefined,
              wq: undefined,
            });
            setLabel(undefined);
          }}
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="space">{t.kind.space}</option>
          <option value="node">{t.kind.node}</option>
        </select>
        <div className="min-w-0 flex-1 basis-64">
          <Combobox
            key={kind}
            label={t.pickTarget}
            placeholder={t.searchTarget}
            source={source}
            value={id === "" ? null : id}
            valueLabel={label}
            onChange={(option) => {
              setLabel(option?.label);
              patch({ id: option?.id, wq: undefined });
            }}
          />
        </div>
        {id !== "" && (
          <Button
            variant="outline"
            disabled={exportCsv.isPending}
            onClick={() => {
              exportCsv.mutate();
            }}
          >
            <Download strokeWidth={1.75} aria-hidden="true" />
            {exportCsv.isPending ? t.exporting : t.export}
          </Button>
        )}
      </div>
      {id === "" ? (
        <EmptyState icon={ScanSearch}>{t.empty}</EmptyState>
      ) : query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {adminErrorText(query.error)}
        </p>
      ) : (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">{t.peopleTitle(name)}</h2>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={texts.sharing.people.search}
            label={texts.sharing.people.search}
            className="max-w-xs"
          />
          <ul className="m-0 list-none divide-y divide-border p-0">
            {people.map((person) => (
              <PersonRow key={person.membershipId} person={person} />
            ))}
          </ul>
          <LoadMore
            hasNextPage={query.hasNextPage}
            isFetching={query.isFetchingNextPage}
            onLoadMore={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
            }}
          />
          <ShownCounter
            shown={people.length}
            total={query.data.pages.at(-1)?.people.total ?? 0}
            className="static border-t-0 px-0"
          />
        </section>
      )}
    </div>
  );
}

function PersonPanel() {
  const t = texts.accessAudit.search;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const id = params.get("id") ?? "";
  const [label, setLabel] = useState<string | undefined>(undefined);
  const source = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "files", "person-options"],
      search: async (text, cursor, signal) => {
        const page = await adminApi.directory(
          workspaceSlug,
          { q: text, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((p) => ({
            id: p.id,
            label: p.name,
            description: p.jobTitle ?? undefined,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
  const query = useInfiniteQuery({
    queryKey: [...accessAuditKeys.all(workspaceSlug), "person", id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => accessAuditApi.person(workspaceSlug, id, pageParam, signal),
    getNextPageParam: (last) => last.spaces.nextCursor ?? undefined,
    enabled: id !== "",
  });
  const spaces = useMemo(
    () => query.data?.pages.flatMap((p) => p.spaces.items) ?? [],
    [query.data],
  );
  const first: PersonAccessReport | undefined = query.data?.pages[0];
  return (
    <div className="grid gap-3">
      <div className="max-w-md">
        <Combobox
          label={t.pickPerson}
          placeholder={t.searchPerson}
          source={source}
          value={id === "" ? null : id}
          valueLabel={label}
          onChange={(option) => {
            setLabel(option?.label);
            patch({ id: option?.id });
          }}
        />
      </div>
      {id === "" ? (
        <EmptyState icon={ScanSearch}>{t.empty}</EmptyState>
      ) : query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError || first === undefined ? (
        <p role="alert" className="text-sm text-danger">
          {adminErrorText(query.error)}
        </p>
      ) : (
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">{t.spacesTitle(first.person.name)}</h2>
            <Button asChild variant="outline" size="sm">
              <Link to={`/app/${workspaceSlug}/admin/access?tab=reports&r=direct-people&p=${id}`}>
                {t.directGrants}
              </Link>
            </Button>
          </div>
          {spaces.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noSpaces}</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {spaces.map((item) => (
                <li key={item.space.id} className="flex flex-wrap items-start gap-3 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-medium">{item.space.name}</p>
                    {item.reasons.slice(0, 3).map((r, index) => (
                      <p key={index} className="text-xs text-muted-foreground">
                        {reasonLine(r)}
                      </p>
                    ))}
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
          <ShownCounter
            shown={spaces.length}
            total={query.data.pages.at(-1)?.spaces.total ?? 0}
            className="static border-t-0 px-0"
          />
          {first.truncated && <p className="text-xs text-muted-foreground">{t.truncated}</p>}
        </section>
      )}
      {id !== "" && <PersonItems membershipId={id} />}
    </div>
  );
}

// ─── Reportes ────────────────────────────────────────────────────────────────────────────

function targetKind(row: ReportRow): string {
  const labels = texts.accessAudit.reports.kindLabel;
  return row.target.type === "space" ? labels.space : labels[row.target.nodeType ?? "FILE"];
}

function ReportsTab() {
  const t = texts.accessAudit.reports;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const kind: ReportKind = readChoice(params, "r", REPORT_KINDS, "cut-inheritance");
  const personId = params.get("p") ?? undefined;
  const query = useInfiniteQuery({
    queryKey: [...accessAuditKeys.all(workspaceSlug), "report", kind, personId ?? ""],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      accessAuditApi.report(
        workspaceSlug,
        kind,
        {
          ...(personId === undefined || kind !== "direct-people" ? {} : { membershipId: personId }),
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const exportCsv = useMutation({
    mutationFn: async () => {
      downloadTextFile(
        `${t.kinds[kind].title}.csv`,
        await accessAuditApi.reportCsv(
          workspaceSlug,
          kind,
          kind === "direct-people" ? personId : undefined,
        ),
      );
    },
    onSuccess: () => {
      toast.success(texts.accessAudit.search.exported);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={texts.accessAudit.tabs.reports}
          className="flex flex-wrap gap-1.5"
        >
          {REPORT_KINDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => {
                patch({ r: value === "cut-inheritance" ? undefined : value, p: undefined });
              }}
              className="h-8 rounded-full border border-border px-3.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:border-primary/30 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
            >
              {t.kinds[value].title}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={exportCsv.isPending}
          onClick={() => {
            exportCsv.mutate();
          }}
        >
          <Download strokeWidth={1.75} aria-hidden="true" />
          {t.export}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t.kinds[kind].text}</p>
      {kind === "direct-people" && personId !== undefined && (
        <div className="flex items-center gap-2 text-sm">
          <Badge>{t.person}</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              patch({ p: undefined });
            }}
          >
            {t.clearPerson}
          </Button>
        </div>
      )}
      {query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {adminErrorText(query.error)}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScanSearch}>{t.empty}</EmptyState>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="p-2 text-left font-medium">
                  {t.columns.target}
                </th>
                <th scope="col" className="p-2 text-left font-medium">
                  {t.columns.space}
                </th>
                {kind !== "cut-inheritance" && (
                  <>
                    <th scope="col" className="p-2 text-left font-medium">
                      {t.columns.who}
                    </th>
                    <th scope="col" className="p-2 text-left font-medium">
                      {t.columns.level}
                    </th>
                    <th scope="col" className="p-2 text-left font-medium">
                      {t.columns.expires}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="p-2">
                    <span className="font-medium">{row.target.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{targetKind(row)}</span>
                  </td>
                  <td className="p-2 text-muted-foreground">{row.target.spaceName}</td>
                  {kind !== "cut-inheritance" && (
                    <>
                      <td className="p-2">{row.subject?.name ?? ""}</td>
                      <td className="p-2">
                        {row.level === null ? "" : texts.accessAudit.levelShort[row.level]}
                      </td>
                      <td className="p-2">
                        {row.expiresAt === null ? "" : formatShortDate(row.expiresAt)}
                      </td>
                    </>
                  )}
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
        shown={rows.length}
        total={query.data?.pages.at(-1)?.total ?? 0}
        className="static border-t-0 px-0"
      />
    </Card>
  );
}

/** Carpetas, páginas y archivos que le compartieron a la persona, con nivel, motivo y vencimiento. */
function PersonItems({ membershipId }: { membershipId: string }) {
  const t = texts.accessAudit.personItems;
  const { workspaceSlug = "" } = useParams();
  const query = useInfiniteQuery({
    queryKey: [...accessAuditKeys.all(workspaceSlug), "person-items", membershipId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      accessAuditApi.personItems(workspaceSlug, membershipId, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  if (query.isPending) return <Skeleton className="h-16 w-full" />;
  if (query.isError) return null;
  return (
    <section className="grid gap-2" aria-label={t.title}>
      <h2 className="text-sm font-semibold">{t.title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {items.map((item) => (
            <li key={item.node.id} className="flex flex-wrap items-start gap-3 py-2">
              <div className="min-w-0 flex-1 basis-48">
                <Link
                  to={
                    item.node.type === "PAGE"
                      ? `/app/${workspaceSlug}/files/${item.node.spaceId}/p/${item.node.id}`
                      : `/app/${workspaceSlug}/files/${item.node.spaceId}/f/${item.node.id}`
                  }
                  className="block truncate text-sm font-medium hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  {item.node.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {[
                    item.node.spaceName,
                    reasonText(item.reason, item.departmentName),
                    item.sharedBy === null ? null : t.sharedBy(item.sharedBy),
                    item.expiresAt === null
                      ? null
                      : texts.files.shared.expires(formatShortDate(item.expiresAt)),
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
  );
}
