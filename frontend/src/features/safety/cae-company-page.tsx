// /app/:slug/seguridad/cae/empresas/:companyId — an external company's record (docs/spec/cae.md,
// «Pantallas»): whether it can work at the site and why, its details and internal responsible person,
// the documents the catalog asks of it with their state, and its workers. Whoever manages CAE edits,
// blocks or archives it; whoever only checks sees the authorization alone.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FolderOpen,
  Pencil,
  Plus,
  ServerCrash,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import {
  CAE_STATES,
  caeApi,
  caeKeys,
  type CaeCompany,
  type CaeStatusSummary,
  type CaeWorkerFilters,
  type CaeWorkerRow,
} from "./cae-api";
import { ArchiveDialog, BlockDialog, CaeStateBadge, useCae } from "./cae-common";
import { CompanyAccessesCard } from "./cae-accesses-page";
import { CompanyForm } from "./cae-company-form";
import { DocumentRequirementsCard } from "./cae-documents";
import { WorkerForm } from "./cae-worker-form";
import { PpeTabs } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.cae.company;

type Action = "edit" | "block" | "archive" | "worker" | null;

export function CaeCompanyPage() {
  const { workspaceSlug = "", companyId = "" } = useParams();
  const cae = useCae();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const company = useQuery({
    queryKey: caeKeys.company(workspaceSlug, companyId),
    queryFn: () => caeApi.company(workspaceSlug, companyId),
    select: (data) => data.company,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
  const close = () => {
    setAction(null);
  };

  if (company.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(company.error)}
        </EmptyState>
      </Card>
    );
  }
  const data = company.data;
  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  const active = data.archivedAt === null;
  const manage = data.canManage && active;

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4">
      <PpeTabs />
      <Link
        to={cae.base}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t.back}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {data.name}
            <CaeStateBadge state={data.status.state} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cae.terms.kinds[data.kind]}
            {data.parent !== null && ` · ${texts.cae.companies.dependsOn(data.parent.name)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PdfButton companyId={data.id} name={data.name} />
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
              {t.edit}
            </Button>
            {data.blocked === null ? (
              <Button
                variant="outline"
                onClick={() => {
                  setAction("block");
                }}
              >
                {t.block}
              </Button>
            ) : (
              <UnblockButton
                done={texts.cae.toasts.unblocked}
                run={async () => {
                  await caeApi.unblockCompany(workspaceSlug, data.id);
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
              {t.archive}
            </Button>
          </div>
        )}
      </div>
      {!active && <p className="text-sm text-muted-foreground">{t.archived}</p>}
      <AuthorizationCard status={data.status} yes={t.authorized} no={t.notAuthorized} />
      {!data.full ? (
        <p className="text-sm text-muted-foreground">{texts.cae.limited}</p>
      ) : (
        <>
          <CompanyData company={data} slug={workspaceSlug} />
          <DocumentRequirementsCard
            title={t.requirementsTitle}
            hint={t.requirementsHint}
            empty={t.noRequirements}
            requirements={data.requirements}
            subject={{ companyId: data.id, workerId: null }}
            canManage={manage}
          />
        </>
      )}
      <WorkersCard
        companyId={data.id}
        canAdd={manage}
        onAdd={() => {
          setAction("worker");
        }}
      />
      {cae.accessLog && <CompanyAccessesCard companyId={data.id} />}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {action === "edit" && <CompanyForm company={data} onClose={close} />}
        {action === "block" && (
          <BlockDialog
            name={data.name}
            done={texts.cae.toasts.blocked}
            onClose={close}
            block={async (reason) => {
              await caeApi.blockCompany(workspaceSlug, data.id, reason);
              await refresh();
            }}
          />
        )}
        {action === "archive" && (
          <ArchiveDialog
            name={data.name}
            text={texts.cae.archive.text}
            done={texts.cae.toasts.archived}
            onClose={close}
            archive={async () => {
              await caeApi.archiveCompany(workspaceSlug, data.id);
              await refresh();
            }}
          />
        )}
        {action === "worker" && <WorkerForm companyId={data.id} worker={null} onClose={close} />}
      </Dialog>
    </div>
  );
}

/** «Autorizados hoy» as a PDF. */
function PdfButton({ companyId, name }: { companyId: string; name: string }) {
  const { workspaceSlug = "" } = useParams();
  const pdf = useMutation({
    mutationFn: async () => {
      downloadBlobFile(`${name}.pdf`, await caeApi.authorizedPdf(workspaceSlug, companyId));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Button
      variant="outline"
      disabled={pdf.isPending}
      onClick={() => {
        pdf.mutate();
      }}
    >
      <Download className="size-4" strokeWidth={1.75} aria-hidden="true" />
      {t.pdf}
    </Button>
  );
}

/** Unblocks right away (it can be blocked again with a reason). */
export function UnblockButton({ run, done }: { run: () => Promise<void>; done: string }) {
  const unblock = useMutation({
    mutationFn: run,
    onSuccess: () => {
      toast.success(done);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Button
      variant="outline"
      disabled={unblock.isPending}
      onClick={() => {
        unblock.mutate();
      }}
    >
      {t.unblock}
    </Button>
  );
}

/** Green «can work» or red with every reason. */
export function AuthorizationCard({
  status,
  yes,
  no,
}: {
  status: CaeStatusSummary;
  yes: string;
  no: string;
}) {
  const Icon = status.authorized ? CheckCircle2 : XCircle;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Icon
          className={
            status.authorized ? "size-5 shrink-0 text-success" : "size-5 shrink-0 text-danger"
          }
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="font-medium">{status.authorized ? yes : no}</p>
          {status.reasons.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {status.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function CompanyData({ company, slug }: { company: CaeCompany; slug: string }) {
  const contact = [company.contactName, company.contactEmail, company.contactPhone].filter(
    (value): value is string => value !== null && value !== "",
  );
  const dates =
    company.startsOn === null && company.endsOn === null
      ? t.noDates
      : [
          company.startsOn === null ? null : t.from(formatUtcDate(company.startsOn)),
          company.endsOn === null ? null : t.until(formatUtcDate(company.endsOn)),
        ]
          .filter((value): value is string => value !== null)
          .join(" · ");
  return (
    <Card className="p-4 sm:p-5">
      <CardTitle className="text-base">{t.data}</CardTitle>
      {company.blocked !== null && (
        <p className="mt-2 text-sm text-danger">{t.blocked(company.blocked.reason)}</p>
      )}
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field label={t.responsible}>{company.responsible?.name ?? t.none}</Field>
        <Field label={t.taxId}>{company.taxId ?? t.none}</Field>
        <Field label={t.activity}>
          {company.activity === null || company.activity === "" ? t.none : company.activity}
        </Field>
        <Field label={t.dates}>{dates}</Field>
        <Field label={t.contact}>{contact.length === 0 ? t.none : contact.join(" · ")}</Field>
        <Field label={t.folder}>
          {company.folder === null ? (
            t.none
          ) : (
            <Link
              to={`/app/${slug}/files/${company.folder.spaceId}/f/${company.folder.id}`}
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              <FolderOpen className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {company.folder.name}
            </Link>
          )}
        </Field>
      </dl>
    </Card>
  );
}

function WorkersCard({
  companyId,
  canAdd,
  onAdd,
}: {
  companyId: string;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const w = texts.cae.workers;
  const { workspaceSlug = "" } = useParams();
  const cae = useCae();
  const { params, patch } = useListParams();
  const filters = useMemo<CaeWorkerFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      status: CAE_STATES.find((state) => state === params.get("estado")),
    }),
    [params],
  );
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const states = useStaticSource(
    "cae-worker-states",
    CAE_STATES.map((id) => ({ id, label: texts.cae.workerStates[id] })),
  );
  const list = useInfiniteList<CaeWorkerRow>({
    queryKey: caeKeys.workers(workspaceSlug, companyId, filters),
    fetchPage: (cursor, signal) =>
      caeApi.workers(workspaceSlug, companyId, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<CaeWorkerRow>[]>(
    () => [
      {
        id: "name",
        header: w.columns.name,
        cell: ({ row }) => (
          <Link
            to={`${cae.base}/trabajadores/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "idNumber",
        header: w.columns.idNumber,
        cell: ({ row }) => row.original.idNumber ?? "—",
      },
      { id: "task", header: w.columns.task, cell: ({ row }) => row.original.task ?? "—" },
      {
        id: "status",
        header: w.columns.status,
        cell: ({ row }) => <CaeStateBadge worker state={row.original.status.state} />,
      },
    ],
    [cae.base, w],
  );
  const filtered = filters.q !== undefined || filters.status !== undefined;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{w.title}</CardTitle>
        {canAdd && (
          <Button size="sm" onClick={onAdd}>
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {w.add}
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <SearchField
          placeholder={w.search}
          label={texts.admin.common.search}
          value={search}
          onChange={setSearch}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={texts.cae.companies.status}
          placeholder={texts.cae.companies.anyStatus}
          source={states}
          value={filters.status ?? null}
          onChange={(option) => {
            patch({ estado: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <EmptyState icon={Users} title={filtered ? w.emptyFiltered : w.empty}>
          {null}
        </EmptyState>
      ) : (
        <DataTable
          label={w.title}
          columns={columns}
          data={list.items}
          getRowId={(worker) => worker.id}
          loading={list.query.isPending}
          paging={{
            total: list.total,
            hasNextPage: list.query.hasNextPage,
            isFetchingNextPage: list.query.isFetchingNextPage,
            onLoadMore: list.loadMore,
          }}
        />
      )}
    </Card>
  );
}
