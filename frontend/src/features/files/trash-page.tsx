// /app/:slug/files/:spaceId/trash — papelera del espacio: lo borrado se guarda 30 días. Se puede
// restaurar (con todo lo que traía) o eliminar para siempre. Lo ve quien puede restaurar (MANAGE);
// el servidor filtra y valida cada acción.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, EmptyState, Skeleton } from "@/components/ui/display";
import { LoadMore, ShownCounter, useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText, loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import { NotFoundPage } from "@/features/home/not-found-page";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { filesApi, filesKeys, trashApi, type TrashItemView } from "./api";
import { NodeIcon } from "./file-utils";
import { texts } from "@/i18n";

const DAY_MS = 86_400_000;

export function TrashPage() {
  const t = texts.files.trash;
  const { workspaceSlug = "", spaceId = "" } = useParams();
  const queryClient = useQueryClient();
  const [purging, setPurging] = useState<TrashItemView | null>(null);
  const space = useQuery({
    queryKey: filesKeys.space(workspaceSlug, spaceId),
    queryFn: () => filesApi.space(workspaceSlug, spaceId),
    select: (data) => data.space,
  });
  const list = useInfiniteList<TrashItemView>({
    queryKey: [...filesKeys.all(workspaceSlug), "trash", spaceId],
    fetchPage: (cursor) => trashApi.trash(workspaceSlug, spaceId, cursor),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
  const restore = useMutation({
    mutationFn: (item: TrashItemView) => trashApi.restoreNode(workspaceSlug, item.id),
    onSuccess: async (result) => {
      toast.success(t.restored(result.node.name));
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  if (space.isError) return <NotFoundPage />;
  const archived = space.data?.archived === true;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <nav aria-label={texts.files.explorer.breadcrumb}>
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 p-0 text-xs text-muted-foreground">
          <li>
            <Link
              className="hover:text-foreground hover:underline"
              to={`/app/${workspaceSlug}/files`}
            >
              {texts.files.nav}
            </Link>{" "}
            ›
          </li>
          <li>
            <Link
              className="hover:text-foreground hover:underline"
              to={`/app/${workspaceSlug}/files/${spaceId}`}
            >
              {space.data?.name ?? "…"}
            </Link>{" "}
            ›
          </li>
          <li aria-current="page" className="font-medium text-foreground">
            {t.title}
          </li>
        </ol>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>

      {list.query.isError && list.query.data === undefined ? (
        <Card className="p-4 sm:p-5">
          <EmptyState
            icon={loadErrorIcon(list.query.error)}
            title={texts.admin.common.loadError}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  void list.query.refetch();
                }}
              >
                {texts.common.retry}
              </Button>
            }
          >
            {loadErrorText(list.query.error)}
          </EmptyState>
        </Card>
      ) : list.query.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : list.items.length === 0 ? (
        <Card className="p-4 sm:p-5">
          <EmptyState icon={Trash2} title={t.empty.title}>
            {t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="m-0 list-none divide-y divide-border p-0">
            {list.items.map((item) => {
              const daysLeft = Math.max(
                0,
                Math.ceil((new Date(item.purgeAt).getTime() - Date.now()) / DAY_MS),
              );
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <NodeIcon node={item} />
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.deletedOn(formatDateTime(item.trashedAt))} · {t.daysLeft(daysLeft)}
                      {item.type === "FOLDER" ? ` · ${t.items(item.items)}` : ""}
                      {item.sizeBytes === null ? "" : ` · ${formatBytes(item.sizeBytes)}`}
                    </p>
                  </div>
                  {!archived && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={restore.isPending}
                        onClick={() => {
                          restore.mutate(item);
                        }}
                      >
                        <RotateCcw strokeWidth={1.75} aria-hidden="true" />
                        {t.restore}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => {
                          setPurging(item);
                        }}
                      >
                        <Trash2 strokeWidth={1.75} aria-hidden="true" />
                        {t.purge}
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <LoadMore
            hasNextPage={list.query.hasNextPage}
            isFetching={list.query.isFetchingNextPage}
            onLoadMore={list.loadMore}
          />
          <ShownCounter shown={list.items.length} total={list.total} />
        </Card>
      )}

      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(open) => {
          if (!open) setPurging(null);
        }}
        icon={Trash2}
        title={purging === null ? "" : t.confirmPurge.title(purging.name)}
        description={t.confirmPurge.text}
        confirmLabel={t.confirmPurge.action}
        pendingLabel={t.confirmPurge.pending}
        tone="destructive"
        onConfirm={async () => {
          if (purging === null) return;
          await trashApi.purgeNode(workspaceSlug, purging.id);
          toast.success(t.purged);
          await refresh();
        }}
      />
    </div>
  );
}
