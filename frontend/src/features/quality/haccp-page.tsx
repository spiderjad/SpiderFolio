// /app/:slug/calidad/appcc — the HACCP plan (docs/spec/calidad.md, «Fase 2»): the plan in force (a
// controlled document of type APPCC) and the critical control points table, each with its form's last 30
// days and its open nonconformities. quality.manage changes the table; quality.view reads it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  FileCheck2,
  Pencil,
  Plus,
  QrCode,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Dialog } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn } from "@/lib/utils";
import { CcpDialog } from "./ccp-dialog";
import { haccpApi, haccpKeys, qualityKeys, type Ccp } from "./quality-api";
import { useQuality } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.haccp;

function CcpCard({
  ccp,
  slug,
  manage,
  first,
  last,
  onEdit,
  onMove,
  onArchive,
  busy,
}: {
  ccp: Ccp;
  slug: string;
  manage: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
  onArchive: () => void;
  busy: boolean;
}) {
  const formBase =
    ccp.form === null ? null : `/app/${slug}/files/${ccp.form.spaceId}/form/${ccp.form.id}`;
  return (
    <Card className={cn("grid gap-3 p-4 sm:p-5", ccp.archived && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
              {ccp.code}
            </span>
            <h2 className="text-base font-semibold">{ccp.name}</h2>
            <Badge tone="neutral">{ccp.step}</Badge>
            <Badge tone={ccp.hazardType === "PHYSICAL" ? "warning" : "primary"}>
              {t.hazardTypes[ccp.hazardType]}
            </Badge>
            {ccp.archived && <Badge tone="neutral">{t.archived}</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{ccp.hazard}</p>
        </div>
        {manage && (
          <div className="flex gap-1">
            {!ccp.archived && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t.moveUp(ccp.code)}
                  disabled={first || busy}
                  onClick={() => {
                    onMove(-1);
                  }}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t.moveDown(ccp.code)}
                  disabled={last || busy}
                  onClick={() => {
                    onMove(1);
                  }}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t.edit(ccp.code)} onClick={onEdit}>
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={ccp.archived ? t.restore : t.archive}
              disabled={busy}
              onClick={onArchive}
            >
              {ccp.archived ? (
                <ArchiveRestore className="size-4" aria-hidden="true" />
              ) : (
                <Archive className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        )}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t.columns.limit}</dt>
          <dd className="font-medium">{ccp.criticalLimit}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.columns.monitoring}</dt>
          <dd>
            {ccp.frequency}
            {ccp.responsible !== null && (
              <span className="text-muted-foreground"> · {ccp.responsible.name}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.form.corrective}</dt>
          <dd className="text-muted-foreground">{ccp.correctiveAction}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.columns.last30}</dt>
          <dd>
            {ccp.stats === null ? (
              <span className="text-muted-foreground">{t.noForm}</span>
            ) : (
              <>
                <span className={ccp.stats.outOfLimits > 0 ? "text-danger" : undefined}>
                  {t.stats(ccp.stats.records, ccp.stats.outOfLimits)}
                </span>
                {ccp.stats.openNcs > 0 && (
                  <span className="block text-xs text-danger">{t.openNcs(ccp.stats.openNcs)}</span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>
      {formBase !== null && ccp.form !== null && (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={formBase}>
              <FileCheck2 className="size-4" aria-hidden="true" />
              {t.records}: {ccp.form.name}
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to={`${formBase}?pestana=ajustes`}>
              <QrCode className="size-4" aria-hidden="true" />
              {t.qr}
            </Link>
          </Button>
        </div>
      )}
    </Card>
  );
}

export function HaccpPage() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { manage } = useQuality();
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Ccp | "new" | null>(null);
  const query = useQuery({
    queryKey: haccpKeys.overview(workspaceSlug, archived),
    queryFn: () => haccpApi.overview(workspaceSlug, archived),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
  const order = useMutation({
    mutationFn: (ids: string[]) => haccpApi.orderCcps(workspaceSlug, ids),
    onSuccess: refresh,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const archive = useMutation({
    mutationFn: (ccp: Ccp) => haccpApi.archiveCcp(workspaceSlug, ccp.id, !ccp.archived),
    onSuccess: async (_result, ccp) => {
      toast.success(ccp.archived ? t.form.restored : t.form.archived);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = query.data;
  const active = (data?.ccps ?? []).filter((ccp) => !ccp.archived);
  const move = (ccp: Ccp, direction: -1 | 1) => {
    const ids = active.map((item) => item.id);
    const index = ids.indexOf(ccp.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] ?? "", ids[index] ?? ""];
    order.mutate(ids);
  };
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setArchived(!archived);
            }}
          >
            {archived ? t.hideArchived : t.showArchived}
          </Button>
          {manage && (
            <Button
              onClick={() => {
                setEditing("new");
              }}
            >
              <Plus strokeWidth={1.75} aria-hidden="true" />
              {t.create}
            </Button>
          )}
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
            <div className="min-w-0">
              <CardTitle>{t.plan}</CardTitle>
              {data.plan === null ? (
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.planNone}</p>
              ) : (
                <p className="mt-1 text-sm">
                  <span className="tabular-nums text-muted-foreground">{data.plan.code}</span>{" "}
                  {data.plan.name}
                </p>
              )}
            </div>
            {data.plan !== null && (
              <Button asChild size="sm" variant="outline">
                <Link
                  to={`/app/${workspaceSlug}/files/${data.plan.spaceId}/${data.plan.page ? "p" : "f"}/${data.plan.nodeId}`}
                >
                  <FileCheck2 className="size-4" aria-hidden="true" />
                  {data.plan.name}
                </Link>
              </Button>
            )}
          </Card>
          {data.ccps.length === 0 ? (
            <Card>
              <EmptyState icon={ShieldAlert} title={t.empty.title}>
                {t.empty.text}
              </EmptyState>
            </Card>
          ) : (
            data.ccps.map((ccp) => (
              <CcpCard
                key={ccp.id}
                ccp={ccp}
                slug={workspaceSlug}
                manage={manage}
                first={active[0]?.id === ccp.id}
                last={active.at(-1)?.id === ccp.id}
                busy={order.isPending || archive.isPending}
                onEdit={() => {
                  setEditing(ccp);
                }}
                onMove={(direction) => {
                  move(ccp, direction);
                }}
                onArchive={() => {
                  archive.mutate(ccp);
                }}
              />
            ))
          )}
        </>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <CcpDialog
            {...(editing === "new" ? {} : { ccp: editing })}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
