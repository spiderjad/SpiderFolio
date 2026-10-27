// «Por espacio»: una tarjeta por espacio con su departamento y visibilidad, y las personas que entran
// agrupadas por nivel efectivo (Gestionan, Editan, Comentan, Ven). Los departamentos van como
// «Finanzas · N personas» desplegable. Debajo, lo compartido dentro del espacio. El motivo de cada
// acceso está en el tooltip. Todo lo calcula el servidor con el motor de acceso.
import { useInfiniteQuery } from "@tanstack/react-query";
import { Building2, Lock, ScanSearch, Share2, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { LoadMore } from "@/components/ui/infinite";
import { reasonText } from "@/features/sharing/reasons";
import { ShareDialog, type ShareSubject } from "@/features/sharing/share-dialog";
import { formatShortDate } from "@/lib/utils";
import { useListParams, useSearchParam } from "../list-params";
import {
  accessAuditApi,
  accessAuditKeys,
  type OverviewEntry,
  type PersonRef,
  type SpaceOverview,
} from "./access-api";
import { texts } from "@/i18n";

export function SpacesTab() {
  const t = texts.accessAudit.bySpace;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const [sharing, setSharing] = useState<ShareSubject | null>(null);
  const query = useInfiniteQuery({
    queryKey: [...accessAuditKeys.all(workspaceSlug), "spaces", q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => accessAuditApi.spaces(workspaceSlug, q, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const spaces = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  return (
    <div className="grid gap-4">
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t.search}
        label={t.search}
        className="max-w-sm"
      />
      {query.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {texts.accessAudit.loadError}
        </p>
      ) : spaces.length === 0 ? (
        <Card>
          <EmptyState icon={ScanSearch}>{t.empty}</EmptyState>
        </Card>
      ) : (
        spaces.map((space) => (
          <SpaceCard
            key={space.id}
            space={space}
            onShare={() => {
              setSharing({ type: "space", id: space.id, name: space.name, spaceId: space.id });
            }}
          />
        ))
      )}
      <LoadMore
        hasNextPage={query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onLoadMore={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
      />
      {query.data?.pages[0]?.truncated === true && (
        <p className="text-xs text-muted-foreground">{t.truncated}</p>
      )}
      <ShareDialog
        subject={sharing}
        onClose={() => {
          setSharing(null);
          void query.refetch();
        }}
      />
    </div>
  );
}

function SpaceCard({ space, onShare }: { space: SpaceOverview; onShare: () => void }) {
  const t = texts.accessAudit.bySpace;
  const { workspaceSlug = "" } = useParams();
  const visibility = space.isConfidential
    ? { label: t.visibility.confidential, icon: ShieldAlert }
    : space.isPrivate
      ? { label: t.visibility.private, icon: Lock }
      : { label: t.visibility.company, icon: Building2 };
  return (
    <Card className="grid gap-4 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="truncate text-base font-semibold">{space.name}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              {space.department === null
                ? t.companySpace
                : t.departmentSpace(space.department.name)}
            </span>
            <span className="inline-flex items-center gap-1">
              <visibility.icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              {visibility.label}
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onShare}>
          <Share2 strokeWidth={1.75} aria-hidden="true" />
          {t.share}
        </Button>
      </div>
      <div className="grid gap-3">
        {space.groups.map((group) => (
          <section
            key={group.level}
            className="grid gap-1.5"
            aria-label={texts.accessAudit.levelGroup[group.level]}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {texts.accessAudit.levelGroup[group.level]} · {group.people}
            </h3>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {group.entries.map((entry, index) => (
                <li
                  key={
                    entry.type === "person"
                      ? entry.person.membershipId
                      : `${entry.key}-${String(index)}`
                  }
                >
                  <Entry entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="grid gap-1.5 border-t border-border pt-3" aria-label={t.sharedInside}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t.sharedInside}
        </h3>
        {space.sharedInside.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.noShared}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {space.sharedInside.items.map((item) => (
              <li key={item.node.id} className="text-sm">
                <Link
                  to={
                    item.node.type === "PAGE"
                      ? `/app/${workspaceSlug}/files/${space.id}/p/${item.node.id}`
                      : `/app/${workspaceSlug}/files/${space.id}/f/${item.node.id}`
                  }
                  className="font-medium hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  {item.node.name}
                </Link>
                <span className="text-muted-foreground">
                  {" — "}
                  {item.grants
                    .map((grant) =>
                      t.shareLine(
                        grant.subject.name,
                        texts.accessAudit.levelShort[grant.level],
                        grant.expiresAt === null ? null : formatShortDate(grant.expiresAt),
                      ),
                    )
                    .join(", ")}
                </span>
              </li>
            ))}
            {space.sharedInside.more > 0 && (
              <li className="text-xs text-muted-foreground">
                {t.moreShared(space.sharedInside.more)}
              </li>
            )}
          </ul>
        )}
      </section>
    </Card>
  );
}

function PersonChip({ person, title }: { person: PersonRef; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2.5 text-sm"
    >
      <Avatar name={person.name} className="size-6 text-[10px]" />
      {person.name}
    </span>
  );
}

function Entry({ entry }: { entry: OverviewEntry }) {
  const t = texts.accessAudit.bySpace;
  if (entry.type === "person") {
    return (
      <PersonChip person={entry.person} title={reasonText(entry.reason, entry.departmentName)} />
    );
  }
  const label = entry.key === "company" ? t.company : entry.label;
  const rest = entry.count - entry.people.length;
  return (
    <details className="group rounded-xl border border-border bg-background">
      <summary
        title={reasonText(entry.reason, entry.key === "company" ? null : entry.label)}
        className="cursor-pointer select-none list-none rounded-xl px-3 py-1 text-sm font-medium hover:bg-muted [&::-webkit-details-marker]:hidden"
      >
        {t.group(label, entry.count)}
      </summary>
      <ul className="m-0 flex max-h-48 list-none flex-wrap gap-1.5 overflow-y-auto p-2 pt-1">
        {entry.people.map((person) => (
          <li key={person.membershipId}>
            <PersonChip person={person} />
          </li>
        ))}
        {rest > 0 && <li className="px-2 text-xs text-muted-foreground">{t.andMore(rest)}</li>}
      </ul>
    </details>
  );
}
