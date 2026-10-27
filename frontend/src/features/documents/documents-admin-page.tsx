// /app/:slug/admin/documents — documentos controlados: listado (código, versión vigente, estado,
// departamento, próxima revisión), bandeja de aprobaciones, cumplimiento de lectura por documento y
// por departamento, y numeración por tipo. Un jefe ve solo su área; el servidor lo acota.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, FileCheck2, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { FormField, Input } from "@/components/ui/form";
import { LoadMore, ShownCounter, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { readChoice, useListParams, useSearchParam } from "@/features/admin/list-params";
import { useMembership } from "@/features/home/workspace-layout";
import { useDepartmentSource } from "@/features/admin/sources";
import { NodeIcon } from "@/features/files/file-utils";
import { cn, formatShortDate } from "@/lib/utils";
import { StatusBadge } from "./control-dialog";
import {
  documentsApi,
  documentsKeys,
  type AdminApprovalRow,
  type AdminDocumentRow,
  type ComplianceCounts,
  type DepartmentCompliance,
  type DocStatus,
  type DocumentCompliance,
  type DocumentTypeAdmin,
} from "./documents-api";
import { texts } from "@/i18n";

const TABS = ["documents", "approvals", "compliance", "numbering"] as const;

function linkOf(slug: string, node: { id: string; type: string; spaceId: string }): string {
  const base = `/app/${slug}/files/${node.spaceId}`;
  return node.type === "PAGE" ? `${base}/p/${node.id}` : base;
}

export function DocumentsAdminPage() {
  const t = texts.documents.admin;
  const { params, patch } = useListParams();
  const { capabilities } = useMembership();
  const canNumber = capabilities.includes("workspace.settings");
  const allowed = canNumber ? TABS : TABS.filter((tab) => tab !== "numbering");
  const tab = readChoice(params, "tab", allowed, "documents");
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div role="tablist" aria-label={t.tabs.label} className="flex flex-wrap gap-1.5">
        {allowed.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              patch({ tab: value === "documents" ? undefined : value, q: undefined });
            }}
            className="h-9 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:border-primary/30 aria-selected:bg-primary-soft aria-selected:font-medium aria-selected:text-primary-soft-foreground"
          >
            {t.tabs[value]}
          </button>
        ))}
      </div>
      {tab === "documents" && <DocumentsTab />}
      {tab === "approvals" && <ApprovalsTab />}
      {tab === "compliance" && <ComplianceTab />}
      {tab === "numbering" && <NumberingTab />}
    </div>
  );
}

// ─── Listado ─────────────────────────────────────────────────────────────────────────────

const STATUSES: readonly DocStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "OBSOLETE",
  "REJECTED",
];

function DocumentsTab() {
  const t = texts.documents.admin.list;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const status = STATUSES.find((value) => value === params.get("estado"));
  const review = params.get("revision") === "vencida" ? "due" : undefined;
  const departmentId = params.get("depto") ?? undefined;
  const [departmentLabel, setDepartmentLabel] = useState<string | undefined>(undefined);
  const departments = useDepartmentSource(workspaceSlug);
  const list = useInfiniteList<AdminDocumentRow>({
    queryKey: [
      ...documentsKeys.all(workspaceSlug),
      "admin",
      "list",
      q,
      status ?? "",
      review ?? "",
      departmentId ?? "",
    ],
    fetchPage: (cursor, signal) =>
      documentsApi.adminDocuments(
        workspaceSlug,
        { q, status, review, departmentId, cursor },
        signal,
      ),
  });
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t.search}
          label={t.search}
          className="max-w-xs"
        />
        <select
          aria-label={t.status}
          value={status ?? ""}
          onChange={(event) => {
            patch({ estado: event.target.value });
          }}
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">{t.allStatuses}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {texts.documents.status[value]}
            </option>
          ))}
        </select>
        <div className="w-56">
          <Combobox
            label={t.department}
            placeholder={t.department}
            source={departments}
            value={departmentId ?? null}
            valueLabel={departmentLabel}
            onChange={(option) => {
              setDepartmentLabel(option?.label);
              patch({ depto: option?.id });
            }}
          />
        </div>
        <button
          type="button"
          aria-pressed={review === "due"}
          onClick={() => {
            patch({ revision: review === "due" ? undefined : "vencida" });
          }}
          className="h-9 rounded-full border border-border px-3.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:border-primary/30 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
        >
          {t.reviewDue}
        </button>
      </div>
      {list.query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : list.query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t.loadError}
        </p>
      ) : list.items.length === 0 ? (
        <EmptyState icon={FileCheck2} title={t.emptyTitle}>
          {t.empty}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-muted">
              <tr>
                {t.columns.map((column) => (
                  <th key={column} scope="col" className="p-2 text-left font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.items.map((row) => {
                const overdue = row.reviewDueAt !== null && new Date(row.reviewDueAt) < new Date();
                return (
                  <tr key={row.node.id} className="border-t border-border">
                    <td className="p-2">
                      <Badge tone="solid">{row.code}</Badge>
                    </td>
                    <td className="p-2">
                      <Link
                        to={linkOf(workspaceSlug, row.node)}
                        className="inline-flex items-center gap-2 font-medium hover:underline"
                      >
                        <NodeIcon node={row.node} className="size-4" />
                        {row.node.name}
                      </Link>
                    </td>
                    <td className="p-2">
                      {row.publishedVersion === null ? "—" : `v${String(row.publishedVersion)}`}
                    </td>
                    <td className="p-2">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="p-2">{row.ownerDepartment?.name ?? "—"}</td>
                    <td className={cn("p-2", overdue && "font-medium text-danger")}>
                      {row.reviewDueAt === null ? "—" : formatShortDate(row.reviewDueAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
      <ShownCounter
        shown={list.items.length}
        total={list.total}
        className="static border-t-0 px-0"
      />
    </Card>
  );
}

// ─── Aprobaciones ────────────────────────────────────────────────────────────────────────

function ApprovalsTab() {
  const t = texts.documents.admin.approvals;
  const { workspaceSlug = "" } = useParams();
  const list = useInfiniteList<AdminApprovalRow>({
    queryKey: [...documentsKeys.all(workspaceSlug), "admin", "approvals"],
    fetchPage: (cursor, signal) => documentsApi.adminApprovals(workspaceSlug, cursor, signal),
  });
  return (
    <Card className="grid gap-3 p-4">
      {list.query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : list.items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t.emptyTitle}>
          {t.empty}
        </EmptyState>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {list.items.map((row) => (
            <li key={`${row.node.id}:${String(row.version)}`} className="grid gap-1 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="solid">{row.code}</Badge>
                <Link
                  to={linkOf(workspaceSlug, row.node)}
                  className="text-sm font-medium hover:underline"
                >
                  {row.node.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {[
                    t.version(row.version),
                    row.submittedBy === null ? null : t.sentBy(row.submittedBy),
                    formatShortDate(row.submittedAt),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              </div>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {row.approvers.map((approver, index) => (
                  <li key={index}>
                    <Badge
                      tone={
                        approver.decision === "APPROVED"
                          ? "success"
                          : approver.decision === "REJECTED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {approver.name} · {t.state[approver.decision ?? "pending"]}
                    </Badge>
                  </li>
                ))}
              </ul>
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
  );
}

// ─── Cumplimiento ────────────────────────────────────────────────────────────────────────

function Progress({ counts }: { counts: ComplianceCounts }) {
  const t = texts.documents.admin.compliance;
  const percent = counts.total === 0 ? 0 : Math.round((counts.read / counts.total) * 100);
  return (
    <div className="grid min-w-40 gap-1">
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t.percent(percent)}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-success-soft-foreground"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t.counts(counts.read, counts.total, counts.pending, counts.overdue)}
      </p>
    </div>
  );
}

function ComplianceTab() {
  const t = texts.documents.admin.compliance;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const view = readChoice(params, "vista", ["doc", "dept"] as const, "doc");
  const byDoc = useInfiniteList<DocumentCompliance>({
    queryKey: [...documentsKeys.all(workspaceSlug), "admin", "compliance", "doc"],
    fetchPage: (cursor, signal) => documentsApi.complianceByDocument(workspaceSlug, cursor, signal),
    enabled: view === "doc",
  });
  const byDept = useInfiniteList<DepartmentCompliance>({
    queryKey: [...documentsKeys.all(workspaceSlug), "admin", "compliance", "dept"],
    fetchPage: (cursor, signal) =>
      documentsApi.complianceByDepartment(workspaceSlug, cursor, signal),
    enabled: view === "dept",
  });
  const active = view === "doc" ? byDoc : byDept;
  return (
    <Card className="grid gap-3 p-4">
      <div
        role="group"
        aria-label={t.label}
        className="inline-flex w-fit rounded-lg border border-border p-0.5"
      >
        {(["doc", "dept"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => {
              patch({ vista: value === "doc" ? undefined : value });
            }}
            className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
          >
            {t.views[value]}
          </button>
        ))}
      </div>
      {active.query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : active.items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t.emptyTitle}>
          {t.empty}
        </EmptyState>
      ) : view === "doc" ? (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {byDoc.items.map((row) => (
            <li key={row.node.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-sm font-medium">
                  <Badge tone="solid" className="mr-2">
                    {row.code}
                  </Badge>
                  {row.node.name}
                </p>
                <p className="text-xs text-muted-foreground">{t.version(row.version)}</p>
              </div>
              <Progress counts={row} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {byDept.items.map((row) => (
            <li key={row.department.id} className="flex flex-wrap items-center gap-3 py-3">
              <p className="min-w-0 flex-1 basis-56 truncate text-sm font-medium">
                {row.department.name}
              </p>
              <Progress counts={row} />
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={active.query.hasNextPage}
        isFetching={active.query.isFetchingNextPage}
        onLoadMore={active.loadMore}
      />
    </Card>
  );
}

// ─── Numeración ──────────────────────────────────────────────────────────────────────────

function NumberingTab() {
  const t = texts.documents.admin.numbering;
  const { workspaceSlug = "" } = useParams();
  const [editing, setEditing] = useState<DocumentTypeAdmin | "new" | null>(null);
  const types = useQuery({
    queryKey: [...documentsKeys.all(workspaceSlug), "admin", "types"],
    queryFn: () => documentsApi.adminTypes(workspaceSlug),
    select: (data) => data.items,
  });
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t.text}</p>
        <Button
          size="sm"
          onClick={() => {
            setEditing("new");
          }}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t.new}
        </Button>
      </div>
      {types.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-muted">
              <tr>
                {t.columns.map((column) => (
                  <th key={column} scope="col" className="p-2 text-left font-medium">
                    {column}
                  </th>
                ))}
                <th scope="col" className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(types.data ?? []).map((type) => (
                <tr key={type.code} className="border-t border-border">
                  <td className="p-2">
                    <Badge tone="solid">{type.code}</Badge>
                  </td>
                  <td className="p-2">{type.name}</td>
                  <td className="p-2">{type.example}</td>
                  <td className="p-2">{type.reviewMonths}</td>
                  <td className="p-2">{type.documents}</td>
                  <td className="p-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t.edit(type.name)}
                      onClick={() => {
                        setEditing(type);
                      }}
                    >
                      <Pencil strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null && (
        <TypeDialog
          type={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

function TypeDialog({ type, onClose }: { type: DocumentTypeAdmin | null; onClose: () => void }) {
  const t = texts.documents.admin.numbering.dialog;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(type?.code ?? "");
  const [name, setName] = useState(type?.name ?? "");
  const [prefix, setPrefix] = useState(type?.prefix ?? "");
  const [padding, setPadding] = useState(String(type?.padding ?? 3));
  const [months, setMonths] = useState(String(type?.reviewMonths ?? 12));
  const [next, setNext] = useState(String(type?.nextNumber ?? 1));
  const preview = useMemo(
    () => `${prefix === "" ? code : prefix}-${next.padStart(Number(padding) || 3, "0")}`,
    [prefix, code, next, padding],
  );
  const save = useMutation({
    mutationFn: () =>
      type === null
        ? documentsApi.createType(workspaceSlug, {
            code,
            name,
            ...(prefix === "" ? {} : { prefix }),
            padding: Number(padding),
            reviewMonths: Number(months),
          })
        : documentsApi.updateType(workspaceSlug, type.code, {
            name,
            prefix,
            padding: Number(padding),
            reviewMonths: Number(months),
            nextNumber: Number(next),
          }),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: documentsKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    extra?: { disabled?: boolean; upper?: boolean; type?: string },
  ) => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          value={value}
          disabled={extra?.disabled === true}
          {...(extra?.type === undefined ? {} : { type: extra.type })}
          onChange={(event) => {
            set(extra?.upper === true ? event.target.value.toUpperCase() : event.target.value);
          }}
        />
      )}
    </FormField>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={type === null ? t.newTitle : t.editTitle(type.name)}
        description={t.text}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={save.isPending}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={save.isPending || name.trim() === "" || code.trim() === ""}
              onClick={() => {
                save.mutate();
              }}
            >
              {texts.admin.common.save}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {field(t.code, code, setCode, { disabled: type !== null, upper: true })}
          {field(t.name, name, setName)}
          {field(t.prefix, prefix, setPrefix, { upper: true })}
          {field(t.padding, padding, setPadding, { type: "number" })}
          {field(t.months, months, setMonths, { type: "number" })}
          {type !== null && field(t.next, next, setNext, { type: "number" })}
          <p className="text-xs text-muted-foreground">{t.preview(preview)}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
