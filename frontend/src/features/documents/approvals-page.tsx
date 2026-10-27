// /app/:slug/aprobaciones — bandeja de aprobaciones: los documentos que esperan la aprobación de la
// persona, de los más nuevos a los más viejos. Abrirlos lleva al documento, donde aprueba o rechaza.
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { Link, useParams } from "react-router";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { LoadMore, ShownCounter, useInfiniteList } from "@/components/ui/infinite";
import { NodeIcon } from "@/features/files/file-utils";
import { formatShortDate } from "@/lib/utils";
import { documentsApi, documentsKeys, type MyApproval } from "./documents-api";
import { texts } from "@/i18n";

export function useApprovalCount(slug: string, enabled: boolean): number {
  const query = useQuery({
    queryKey: [...documentsKeys.approvals(slug), "count"],
    queryFn: () => documentsApi.myApprovals(slug),
    enabled,
    staleTime: 30_000,
    select: (page) => page.total,
  });
  return query.data ?? 0;
}

export function ApprovalsPage() {
  const t = texts.documents.approvals;
  const { workspaceSlug = "" } = useParams();
  const list = useInfiniteList<MyApproval>({
    queryKey: [...documentsKeys.approvals(workspaceSlug), "list"],
    fetchPage: (cursor, signal) => documentsApi.myApprovals(workspaceSlug, cursor, signal),
  });
  // «Revisar» abre el documento: una página, en su editor; un archivo, en su carpeta con el panel de
  // documento controlado abierto (ahí se aprueba o se rechaza).
  const linkOf = (item: MyApproval): string => {
    const { node } = item;
    const base = `/app/${workspaceSlug}/files/${node.spaceId}`;
    if (node.type === "PAGE") return `${base}/p/${node.id}`;
    if (node.type === "FOLDER") return `${base}/f/${node.id}`;
    const folder = node.parentId === null ? base : `${base}/f/${node.parentId}`;
    return `${folder}?${new URLSearchParams({ revisar: node.id }).toString()}`;
  };
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <Card className="overflow-hidden">
        {list.query.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.query.isError ? (
          <p role="alert" className="p-4 text-sm text-danger">
            {t.loadError}
          </p>
        ) : list.items.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={t.emptyTitle}>
            {t.empty}
          </EmptyState>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {list.items.map((item) => (
              <li key={`${item.node.id}:${String(item.version)}`}>
                <Link
                  to={linkOf(item)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                >
                  <NodeIcon node={item.node} className="size-6" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.node.name}</span>
                      <Badge tone="solid">{item.code}</Badge>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        t.version(item.version),
                        item.submittedBy === null ? null : t.sentBy(item.submittedBy),
                        formatShortDate(item.submittedAt),
                        item.node.spaceName,
                        item.changeNote,
                      ]
                        .filter((part) => part !== null && part !== "")
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-primary">{t.review}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <LoadMore
          hasNextPage={list.query.hasNextPage}
          isFetching={list.query.isFetchingNextPage}
          onLoadMore={list.loadMore}
        />
      </Card>
      {list.items.length > 0 && (
        <ShownCounter
          shown={list.items.length}
          total={list.total}
          className="static border-t-0 px-0"
        />
      )}
    </div>
  );
}
