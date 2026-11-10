// «Suggest a resolution» on the work order (docs/spec/mantenimiento.md, section 4): the possible causes,
// the most likely first, each with its steps and the work orders and documents it comes from. Only a
// suggestion: the technician says whether it helped. Shown with Bian on, to whoever works on the order.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Sparkles, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Banner, Card, CardTitle } from "@/components/ui/display";
import { adminErrorText } from "@/features/admin/admin-utils";
import { docPath, type NodeType } from "@/features/bian/bian-api";
import { formatDateTime } from "@/lib/utils";
import {
  maintenanceApi,
  maintenanceKeys,
  type Suggestion,
  type WorkOrderDetail,
} from "./maintenance-api";
import { texts } from "@/i18n";

const t = texts.maintenance.suggest;
const TONE = { high: "danger", medium: "warning", low: "neutral" } as const;

export function SuggestionCard({
  data,
  canAsk,
}: {
  data: WorkOrderDetail;
  /** Bian on and the person works on the order. */
  canAsk: boolean;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const key = maintenanceKeys.workOrder(workspaceSlug, data.id);
  const ask = useMutation({
    mutationFn: () => maintenanceApi.suggest(workspaceSlug, data.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const rate = useMutation({
    mutationFn: ({ suggestion, useful }: { suggestion: Suggestion; useful: boolean }) =>
      maintenanceApi.rateSuggestion(workspaceSlug, data.id, suggestion.id, useful),
    onSuccess: async () => {
      toast.success(t.thanks);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const suggestion = data.suggestion;
  if (suggestion === null && !canAsk) return null;
  const sourceOf = new Map((suggestion?.sources ?? []).map((source) => [source.ref, source]));
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            {t.title}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
        </div>
        {canAsk && (
          <Button
            size="sm"
            variant={suggestion === null ? "primary" : "outline"}
            disabled={ask.isPending}
            onClick={() => {
              ask.mutate();
            }}
          >
            {ask.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            {ask.isPending ? t.working : suggestion === null ? t.action : t.again}
          </Button>
        )}
      </div>
      {suggestion !== null && (
        <>
          {suggestion.note !== "" && <Banner tone="warning">{suggestion.note}</Banner>}
          {suggestion.causes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.empty}</p>
          ) : (
            <ol className="grid gap-3">
              {suggestion.causes.map((cause, index) => (
                <li
                  key={`${String(index)}-${cause.cause}`}
                  className="grid gap-2 rounded-lg border border-border p-3"
                >
                  <p className="flex flex-wrap items-start gap-2">
                    <span className="font-medium">
                      {index + 1}. {cause.cause}
                    </span>
                    <Badge tone={TONE[cause.likelihood]}>{t.likelihood[cause.likelihood]}</Badge>
                  </p>
                  {cause.steps.length > 0 && (
                    <ol className="ml-5 grid list-decimal gap-1 text-sm">
                      {cause.steps.map((step, at) => (
                        <li key={`${String(at)}-${step}`}>{step}</li>
                      ))}
                    </ol>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs">
                    {cause.sources.length === 0 ? (
                      <span className="text-muted-foreground">{t.general}</span>
                    ) : (
                      cause.sources.map((ref) => {
                        const source = sourceOf.get(ref);
                        if (source === undefined) return null;
                        const to =
                          source.kind === "work_order"
                            ? `/app/${workspaceSlug}/mantenimiento/ot/${source.id}`
                            : docPath(workspaceSlug, {
                                nodeId: source.id,
                                nodeType: (source.nodeType ?? "FILE") as NodeType,
                                spaceId: source.spaceId ?? "",
                                parentId: source.parentId,
                              });
                        const Icon = source.kind === "work_order" ? Wrench : FileText;
                        return (
                          <Link
                            key={ref}
                            to={to}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-primary hover:bg-muted"
                          >
                            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{source.label}</span>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t.by(suggestion.by, formatDateTime(suggestion.createdAt))}</span>
            {canAsk && (
              <span className="flex items-center gap-1">
                <span>{t.helped}</span>
                {([true, false] as const).map((useful) => (
                  <Button
                    key={String(useful)}
                    size="sm"
                    variant={suggestion.useful === useful ? "primary" : "ghost"}
                    aria-pressed={suggestion.useful === useful}
                    disabled={rate.isPending}
                    onClick={() => {
                      rate.mutate({ suggestion, useful });
                    }}
                  >
                    {useful ? (
                      <ThumbsUp className="size-4" aria-hidden="true" />
                    ) : (
                      <ThumbsDown className="size-4" aria-hidden="true" />
                    )}
                    {useful ? t.useful : t.notUseful}
                  </Button>
                ))}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
