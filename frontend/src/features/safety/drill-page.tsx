// /app/:slug/seguridad/emergencias/simulacros/:drillId — one drill (docs/spec/seguridad-salud.md,
// «Emergencias y simulacros»): what happened and the measures planned from it (origin DRILL).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { InfiniteList, useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { NotFoundPage } from "@/features/home/not-found-page";
import { formatUtcDate } from "@/lib/utils";
import { ActionDialog } from "./action-dialog";
import { DrillDialog } from "./drills-page";
import { EmergencyNav } from "./emergencies-page";
import {
  emergenciesApi,
  emergenciesKeys,
  incidentsApi,
  incidentsKeys,
  planningApi,
  planningKeys,
  type PlanningFilters,
  type SafetyAction,
} from "./safety-api";
import { PpeTabs } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.drills;
const p = texts.safety.planning;

export function DrillPage() {
  const { workspaceSlug = "", drillId = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<SafetyAction | "new" | null>(null);
  const query = useQuery({
    queryKey: emergenciesKeys.drill(workspaceSlug, drillId),
    queryFn: () => emergenciesApi.drill(workspaceSlug, drillId),
    select: (data) => data.drill,
  });
  const filters: PlanningFilters = { drill: drillId, status: "all" };
  const actions = useInfiniteList<SafetyAction>({
    queryKey: planningKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => planningApi.list(workspaceSlug, filters, cursor, signal),
  });
  const done = useMutation({
    mutationFn: (id: string) => incidentsApi.done(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(texts.safety.incidents.toasts.done);
      await queryClient.invalidateQueries({ queryKey: incidentsKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (query.isError) return <NotFoundPage />;
  const drill = query.data;
  const d = t.detail;
  const scenario = drill === undefined ? "" : t.scenarios[drill.scenario];
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            to={`/app/${workspaceSlug}/seguridad/emergencias/simulacros`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            {d.back}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {drill === undefined ? t.title : `${scenario} · ${formatUtcDate(drill.date)}`}
          </h1>
        </div>
        {drill !== undefined && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {d.edit}
          </Button>
        )}
      </div>
      <PpeTabs />
      <EmergencyNav />
      {drill === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <Card className="grid gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone={drill.announced ? "neutral" : "primary"}>
                {drill.announced ? d.announced : d.unannounced}
              </Badge>
              {drill.area !== null && <Badge>{drill.area}</Badge>}
              {drill.participants !== null && <Badge>{d.participants(drill.participants)}</Badge>}
              {drill.evacuationSeconds !== null && (
                <Badge tone="primary">{d.evacuation(t.seconds(drill.evacuationSeconds))}</Badge>
              )}
            </div>
            {drill.incidents !== null && (
              <div>
                <h2 className="text-sm font-medium">{d.incidents}</h2>
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                  {drill.incidents}
                </p>
              </div>
            )}
            {drill.document !== null && (
              <Link
                to={
                  drill.document.type === "PAGE"
                    ? `/app/${workspaceSlug}/files/${drill.document.spaceId}/p/${drill.document.id}`
                    : `/app/${workspaceSlug}/files/${drill.document.spaceId}`
                }
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {drill.document.name}
              </Link>
            )}
            <p className="text-xs text-muted-foreground">
              {[
                drill.observers === null ? null : d.observers(drill.observers),
                d.by(drill.createdBy.name),
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            </p>
          </Card>
          <Card className="grid gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{d.actionsTitle}</CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setAdding("new");
                }}
              >
                <Plus strokeWidth={1.75} aria-hidden="true" />
                {d.addAction}
              </Button>
            </div>
            {!actions.query.isPending && actions.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{d.noActions}</p>
            ) : (
              <InfiniteList
                label={d.actionsTitle}
                items={actions.items}
                getKey={(action) => action.id}
                paging={{
                  total: actions.total,
                  hasNextPage: actions.query.hasNextPage,
                  isFetchingNextPage: actions.query.isFetchingNextPage,
                  onLoadMore: actions.loadMore,
                }}
                renderItem={(action) => (
                  <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p
                        className={
                          action.done === null
                            ? "text-sm font-medium"
                            : "text-sm text-muted-foreground line-through"
                        }
                      >
                        {action.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {action.responsible.name} · {formatUtcDate(action.dueOn)} ·{" "}
                        {p.priorities[action.priority]}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {action.done !== null && <Badge tone="success">{p.done}</Badge>}
                      {action.overdue && <Badge tone="danger">{p.overdue}</Badge>}
                      {action.done === null && action.canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={p.markDone}
                            disabled={done.isPending}
                            onClick={() => {
                              done.mutate(action.id);
                            }}
                          >
                            <CheckCircle2
                              className="size-4"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={p.edit(action.description)}
                            onClick={() => {
                              setAdding(action);
                            }}
                          >
                            <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              />
            )}
          </Card>
          <Dialog open={editing} onOpenChange={setEditing}>
            {editing && (
              <DrillDialog
                drill={drill}
                onClose={() => {
                  setEditing(false);
                }}
              />
            )}
          </Dialog>
          <Dialog
            open={adding !== null}
            onOpenChange={(open) => {
              if (!open) setAdding(null);
            }}
          >
            {adding !== null && (
              <ActionDialog
                {...(adding === "new"
                  ? {
                      from: {
                        origin: "DRILL" as const,
                        drillId: drill.id,
                        label: `${scenario} · ${formatUtcDate(drill.date)}`,
                      },
                    }
                  : { action: adding })}
                onClose={() => {
                  setAdding(null);
                }}
              />
            )}
          </Dialog>
        </>
      )}
    </div>
  );
}
