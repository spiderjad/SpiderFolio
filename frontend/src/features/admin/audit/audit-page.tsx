// Administración › Registro de auditoría: eventos del workspace con filtros por persona, área o acción,
// elemento y fechas (en la URL), scroll infinito, detalle de cada evento y exportación a CSV con los
// mismos filtros. La ven quienes tienen audit.view; exportar pide audit.export.
import { useMutation } from "@tanstack/react-query";
import { Download, ScrollText } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { InfiniteList, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import {
  adminErrorText,
  downloadTextFile,
  loadErrorIcon,
  loadErrorText,
} from "@/features/admin/admin-utils";
import { useCan } from "@/features/admin/guards";
import { useListParams } from "@/features/admin/list-params";
import { useMemberSource } from "@/features/admin/sources";
import { formatDateTime } from "@/lib/utils";
import { auditApi, auditKeys, type AuditEvent, type AuditFilters } from "./audit-api";
import { locale, texts } from "@/i18n";

/** "Creó un código QR" → "creó un código QR": only the first letter, so acronyms keep their case. */
function lowerFirst(label: string): string {
  return label.charAt(0).toLocaleLowerCase(locale) + label.slice(1);
}

const t = texts.audit;
const select =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

const actionLabel = (action: string): string => t.actions[action] ?? action;

function actorLabel(event: AuditEvent): string {
  if (event.actor === null) return t.actor.system;
  if (event.actor.staff) return t.actor.staff;
  const name = event.actor.name ?? t.actor.unknown;
  // Done through the connector for Claude: «Ana Ruiz vía Claude».
  const via = event.metadata as { via?: unknown; client?: unknown } | null;
  return via?.via === "mcp" && typeof via.client === "string"
    ? t.actor.via(name, via.client)
    : name;
}

export function AuditPage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const filters: AuditFilters = {
    memberId: params.get("persona") ?? "",
    action: params.get("accion") ?? "",
    entityType: params.get("elemento") ?? "",
    from: params.get("desde") ?? "",
    to: params.get("hasta") ?? "",
  };
  const [memberLabel, setMemberLabel] = useState<string | undefined>();
  const [detail, setDetail] = useState<AuditEvent | null>(null);
  const people = useMemberSource(workspaceSlug, { status: "" });
  const canExport = useCan("audit.export");
  const filtered = Object.values(filters).some((value) => value !== "");

  const list = useInfiniteList<AuditEvent>({
    queryKey: auditKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => auditApi.list(workspaceSlug, filters, cursor, signal),
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      downloadTextFile("registro-de-auditoria.csv", await auditApi.csv(workspaceSlug, filters));
    },
    onSuccess: () => {
      toast.success(t.exported);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const area = filters.action.endsWith(".") ? filters.action : "";
  const exact = filters.action.endsWith(".") ? "" : filters.action;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {canExport && (
          <div className="grid justify-items-end gap-1">
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
          </div>
        )}
      </div>

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.person}
          <Combobox
            label={t.filters.person}
            placeholder={t.filters.personAll}
            source={people}
            value={filters.memberId === "" ? null : filters.memberId}
            {...(memberLabel === undefined ? {} : { valueLabel: memberLabel })}
            onChange={(option) => {
              setMemberLabel(option?.label);
              patch({ persona: option?.id });
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.area}
          <select
            className={select}
            value={area}
            onChange={(event) => {
              patch({ accion: event.target.value });
            }}
          >
            <option value="">{t.filters.areaAll}</option>
            {Object.entries(t.areas).map(([prefix, label]) => (
              <option key={prefix} value={prefix}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.action}
          <select
            className={select}
            value={exact}
            onChange={(event) => {
              patch({ accion: event.target.value });
            }}
          >
            <option value="">{t.filters.actionAll}</option>
            {Object.entries(t.actions)
              .sort((a, b) => a[1].localeCompare(b[1], locale))
              .map(([action, label]) => (
                <option key={action} value={action}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.entity}
          <select
            className={select}
            value={filters.entityType}
            onChange={(event) => {
              patch({ elemento: event.target.value });
            }}
          >
            <option value="">{t.filters.entityAll}</option>
            {Object.entries(t.entities).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.from}
          <Input
            type="date"
            value={filters.from}
            max={filters.to === "" ? undefined : filters.to}
            onChange={(event) => {
              patch({ desde: event.target.value });
            }}
            className="h-9"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.to}
          <Input
            type="date"
            value={filters.to}
            min={filters.from === "" ? undefined : filters.from}
            onChange={(event) => {
              patch({ hasta: event.target.value });
            }}
            className="h-9"
          />
        </label>
        {filtered && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMemberLabel(undefined);
                patch({
                  persona: undefined,
                  accion: undefined,
                  elemento: undefined,
                  desde: undefined,
                  hasta: undefined,
                });
              }}
            >
              {t.filters.clear}
            </Button>
          </div>
        )}
      </Card>

      <Card>
        {list.query.isError && list.items.length === 0 ? (
          <EmptyState icon={loadErrorIcon(list.query.error)} title={t.loadError}>
            {loadErrorText(list.query.error)}
          </EmptyState>
        ) : list.query.isPending ? (
          <Skeleton className="m-4 h-48" />
        ) : list.items.length === 0 ? (
          <EmptyState icon={ScrollText}>{t.empty}</EmptyState>
        ) : (
          <InfiniteList
            items={list.items}
            getKey={(item) => item.id}
            estimateHeight={64}
            maxHeightClass="max-h-[65vh]"
            label={t.title}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
            renderItem={(event) => (
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={() => {
                  setDetail(event);
                }}
              >
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{actorLabel(event)}</span>{" "}
                    <span className="text-muted-foreground">
                      {lowerFirst(actionLabel(event.action))}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {event.action}
                    {event.entityType !== null &&
                      ` · ${t.entities[event.entityType] ?? event.entityType}`}
                  </p>
                </div>
                <time
                  dateTime={event.createdAt}
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {formatDateTime(event.createdAt)}
                </time>
              </button>
            )}
          />
        )}
      </Card>

      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        {detail !== null && (
          <DialogContent
            title={t.detail.title}
            size="lg"
            footer={
              <DialogClose asChild>
                <Button variant="outline">{t.detail.close}</Button>
              </DialogClose>
            }
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">{t.detail.when}</dt>
              <dd>{formatDateTime(detail.createdAt)}</dd>
              <dt className="text-muted-foreground">{t.detail.who}</dt>
              <dd>
                {actorLabel(detail)}
                {detail.actor?.email != null && (
                  <span className="text-muted-foreground"> · {detail.actor.email}</span>
                )}
              </dd>
              <dt className="text-muted-foreground">{t.detail.what}</dt>
              <dd>
                {actionLabel(detail.action)}
                <span className="block text-xs text-muted-foreground">{detail.action}</span>
              </dd>
              {detail.entityType !== null && (
                <>
                  <dt className="text-muted-foreground">{t.detail.entity}</dt>
                  <dd className="break-all">
                    {t.entities[detail.entityType] ?? detail.entityType}
                    {detail.entityId !== null && (
                      <span className="block text-xs text-muted-foreground">{detail.entityId}</span>
                    )}
                  </dd>
                </>
              )}
              {detail.ip !== null && (
                <>
                  <dt className="text-muted-foreground">{t.detail.ip}</dt>
                  <dd>{detail.ip}</dd>
                </>
              )}
              {detail.userAgent !== null && (
                <>
                  <dt className="text-muted-foreground">{t.detail.device}</dt>
                  <dd className="break-words text-xs">{detail.userAgent}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t.detail.metadata}</dt>
              <dd>
                {detail.metadata === null || detail.metadata === undefined ? (
                  <span className="text-muted-foreground">{t.detail.none}</span>
                ) : (
                  <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
                    {JSON.stringify(detail.metadata, null, 2)}
                  </pre>
                )}
              </dd>
            </dl>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
