// /app/:slug/seguridad/cae/trabajadores/:workerId — a contractor's worker (docs/spec/cae.md,
// «Pantallas»): whether they can come in and why, their details and the documents the catalog asks of
// them. Whoever manages CAE edits, blocks or archives them. The worker's QR comes in phase 3.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, ServerCrash } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Dialog } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { caeApi, caeKeys } from "./cae-api";
import { ArchiveDialog, BlockDialog, CaeStateBadge, useCae } from "./cae-common";
import { AuthorizationCard, UnblockButton } from "./cae-company-page";
import { DocumentRequirementsCard } from "./cae-documents";
import { WorkerForm } from "./cae-worker-form";
import { PpeTabs } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.cae.worker;

export function CaeWorkerPage() {
  const { workspaceSlug = "", workerId = "" } = useParams();
  const cae = useCae();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<"edit" | "block" | "archive" | null>(null);
  const worker = useQuery({
    queryKey: caeKeys.worker(workspaceSlug, workerId),
    queryFn: () => caeApi.worker(workspaceSlug, workerId),
    select: (data) => data.worker,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
  const close = () => {
    setAction(null);
  };

  if (worker.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(worker.error)}
        </EmptyState>
      </Card>
    );
  }
  const data = worker.data;
  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  const manage = data.canManage && data.archivedAt === null;

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4">
      <PpeTabs />
      <Link
        to={`${cae.base}/empresas/${data.company.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {data.company.name}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {data.name}
            <CaeStateBadge worker state={data.status.state} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.company(data.company.name)}</p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAction("edit");
              }}
            >
              <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {texts.cae.company.edit}
            </Button>
            {data.blocked === null ? (
              <Button
                variant="outline"
                onClick={() => {
                  setAction("block");
                }}
              >
                {texts.cae.company.block}
              </Button>
            ) : (
              <UnblockButton
                done={texts.cae.toasts.workerUnblocked}
                run={async () => {
                  await caeApi.unblockWorker(workspaceSlug, data.id);
                  await refresh();
                }}
              />
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setAction("archive");
              }}
            >
              {texts.cae.company.archive}
            </Button>
          </div>
        )}
      </div>
      {data.archivedAt !== null && <p className="text-sm text-muted-foreground">{t.archived}</p>}
      <AuthorizationCard status={data.status} yes={t.authorized} no={t.notAuthorized} />
      <Card className="p-4 sm:p-5">
        <CardTitle className="text-base">{texts.cae.company.data}</CardTitle>
        {data.blocked !== null && (
          <p className="mt-2 text-sm text-danger">{t.blocked(data.blocked.reason)}</p>
        )}
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t.idNumber}</dt>
            <dd className="mt-0.5 text-sm">{data.idNumber ?? texts.cae.company.none}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.task}</dt>
            <dd className="mt-0.5 text-sm">{data.task ?? texts.cae.company.none}</dd>
          </div>
        </dl>
      </Card>
      {data.full ? (
        <DocumentRequirementsCard
          title={t.requirementsTitle}
          hint={texts.cae.company.requirementsHint}
          empty={t.noRequirements}
          requirements={data.requirements}
          subject={{ companyId: data.company.id, workerId: data.id }}
          canManage={manage}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{texts.cae.limited}</p>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {action === "edit" && (
          <WorkerForm companyId={data.company.id} worker={data} onClose={close} />
        )}
        {action === "block" && (
          <BlockDialog
            name={data.name}
            done={texts.cae.toasts.workerBlocked}
            onClose={close}
            block={async (reason) => {
              await caeApi.blockWorker(workspaceSlug, data.id, reason);
              await refresh();
            }}
          />
        )}
        {action === "archive" && (
          <ArchiveDialog
            name={data.name}
            text={texts.cae.archive.workerText}
            done={texts.cae.toasts.workerArchived}
            onClose={close}
            archive={async () => {
              await caeApi.archiveWorker(workspaceSlug, data.id);
              await refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
