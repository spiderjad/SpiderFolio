// /app/:slug/seguridad/cae/catalogo — the documents asked of contractors (docs/spec/cae.md,
// «Catálogo por defecto»): those of the company and those of each worker, in their order, how long
// each lasts, which companies they apply to and whether they're mandatory. Archived instead of
// deleted. Only whoever manages CAE.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, CardTitle } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { caeApi, caeKeys, type CaeAppliesTo, type CaeRequirement, type CaeScope } from "./cae-api";
import { CaeNav, useCae } from "./cae-common";
import { InfoSettingsCard } from "./cae-info";
import { texts } from "@/i18n";

const t = texts.cae.catalog;
const SCOPES: readonly CaeScope[] = ["COMPANY", "WORKER"];
const APPLIES: readonly CaeAppliesTo[] = ["ALL", "CONTRACTOR", "CONCURRENT"];

type Editing = { scope: CaeScope; requirement: CaeRequirement | null } | null;

export function CaeCatalogPage() {
  const cae = useCae();
  const { params, patch } = useListParams();
  const archived = params.get("archivados") === "1";
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button
          onClick={() => {
            setEditing({ scope: "COMPANY", requirement: null });
          }}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t.create}
        </Button>
      </div>
      <CaeNav />
      <InfoSettingsCard />
      <Checkbox
        label={t.showArchived}
        checked={archived}
        onChange={(event) => {
          patch({ archivados: event.target.checked ? "1" : undefined });
        }}
      />
      {SCOPES.map((scope) => (
        <ScopeList
          key={scope}
          scope={scope}
          archived={archived}
          kinds={cae.terms.kinds}
          onEdit={(requirement) => {
            setEditing({ scope, requirement });
          }}
        />
      ))}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <RequirementForm
            key={editing.requirement?.id ?? "new"}
            scope={editing.scope}
            requirement={editing.requirement}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function ScopeList({
  scope,
  archived,
  kinds,
  onEdit,
}: {
  scope: CaeScope;
  archived: boolean;
  kinds: Record<"CONTRACTOR" | "SUBCONTRACTOR" | "CONCURRENT", string>;
  onEdit: (requirement: CaeRequirement) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const list = useInfiniteList<CaeRequirement>({
    queryKey: caeKeys.requirements(workspaceSlug, scope, archived),
    fetchPage: (cursor, signal) =>
      caeApi.requirements(workspaceSlug, scope, archived, cursor, signal),
  });
  const active = useMemo(() => list.items.filter((item) => !item.archived), [list.items]);
  // Reordering needs every active one of the scope on screen.
  const canOrder = !list.query.hasNextPage && !list.query.isFetching;
  const order = useMutation({
    mutationFn: (ids: string[]) => caeApi.orderRequirements(workspaceSlug, scope, ids),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const columns = useMemo<ColumnDef<CaeRequirement>[]>(() => {
    const move = (item: CaeRequirement, delta: -1 | 1) => {
      const ids = active.map((row) => row.id);
      const from = ids.indexOf(item.id);
      const to = from + delta;
      const other = ids[to];
      if (from < 0 || other === undefined) return;
      ids[to] = item.id;
      ids[from] = other;
      order.mutate(ids);
    };
    return [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            {row.original.name}
            <Badge tone={row.original.required ? "primary" : "neutral"}>
              {row.original.required ? t.required : t.optional}
            </Badge>
            {row.original.archived && <Badge tone="warning">{t.archived}</Badge>}
          </p>
        ),
      },
      {
        id: "validity",
        header: t.columns.validity,
        cell: ({ row }) =>
          row.original.validityMonths === null ? (
            <span className="text-muted-foreground">{t.noValidity}</span>
          ) : (
            texts.cae.company.validity(row.original.validityMonths)
          ),
      },
      {
        id: "appliesTo",
        header: t.columns.appliesTo,
        cell: ({ row }) =>
          row.original.appliesTo === "ALL"
            ? texts.cae.appliesTo.ALL
            : row.original.appliesTo === "CONCURRENT"
              ? kinds.CONCURRENT
              : `${kinds.CONTRACTOR} · ${kinds.SUBCONTRACTOR}`,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t.columns.actions}</span>,
        cell: ({ row }) => {
          const index = active.findIndex((item) => item.id === row.original.id);
          return (
            <div className="flex justify-end gap-1">
              {!row.original.archived && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.moveUp(row.original.name)}
                    disabled={!canOrder || order.isPending || index <= 0}
                    onClick={() => {
                      move(row.original, -1);
                    }}
                  >
                    <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.moveDown(row.original.name)}
                    disabled={!canOrder || order.isPending || index >= active.length - 1}
                    onClick={() => {
                      move(row.original, 1);
                    }}
                  >
                    <ArrowDown className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.edit(row.original.name)}
                onClick={() => {
                  onEdit(row.original);
                }}
              >
                <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
          );
        },
      },
    ];
  }, [active, canOrder, order, kinds, onEdit]);
  const title = scope === "COMPANY" ? t.companyTitle : t.workerTitle;
  return (
    <Card className="grid gap-3 p-0">
      <CardTitle className="px-4 pt-4 text-base sm:px-5">{title}</CardTitle>
      {!list.query.isPending && list.items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">{t.empty}</p>
      ) : (
        <DataTable
          label={title}
          columns={columns}
          data={list.items}
          getRowId={(item) => item.id}
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

function RequirementForm({
  scope: initialScope,
  requirement,
  onClose,
}: {
  scope: CaeScope;
  requirement: CaeRequirement | null;
  onClose: () => void;
}) {
  const f = t.form;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const cae = useCae();
  const scopes = useStaticSource(
    "cae-scopes",
    SCOPES.map((id) => ({ id, label: texts.cae.scopes[id] })),
  );
  const applies = useStaticSource(
    `cae-applies-${cae.terms.companies}`,
    APPLIES.map((id) => ({
      id,
      label:
        id === "ALL"
          ? texts.cae.appliesTo.ALL
          : id === "CONCURRENT"
            ? texts.cae.appliesTo.CONCURRENT
            : `${cae.terms.kinds.CONTRACTOR} · ${cae.terms.kinds.SUBCONTRACTOR}`,
    })),
  );
  const [scope, setScope] = useState<CaeScope>(requirement?.scope ?? initialScope);
  const [name, setName] = useState(requirement?.name ?? "");
  const [validity, setValidity] = useState(
    requirement === null || requirement.validityMonths === null
      ? ""
      : String(requirement.validityMonths),
  );
  const [appliesTo, setAppliesTo] = useState<CaeAppliesTo>(requirement?.appliesTo ?? "ALL");
  const [required, setRequired] = useState(requirement?.required ?? true);
  const [error, setError] = useState<string | null>(null);
  const done = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const months = Number.parseInt(validity, 10);
      const body = {
        name: name.trim(),
        validityMonths: Number.isInteger(months) && months > 0 ? months : null,
        appliesTo,
        required,
      };
      return requirement === null
        ? caeApi.createRequirement(workspaceSlug, { ...body, scope })
        : caeApi.updateRequirement(workspaceSlug, requirement.id, body);
    },
    onSuccess: () => done(requirement === null ? t.toasts.created : t.toasts.updated),
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      requirement?.archived === true
        ? caeApi.updateRequirement(workspaceSlug, requirement.id, { archived: false })
        : caeApi.archiveRequirement(workspaceSlug, requirement?.id ?? ""),
    onSuccess: () => done(requirement?.archived === true ? t.toasts.restored : t.toasts.archived),
    onError: (failure) => {
      toast.error(adminErrorText(failure));
    },
  });
  const busy = save.isPending || archive.isPending;
  return (
    <DialogContent
      title={requirement === null ? f.createTitle : f.editTitle}
      footer={
        <>
          {requirement !== null && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => {
                archive.mutate();
              }}
            >
              {requirement.archived ? f.restore : f.archive}
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={busy || name.trim() === ""}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending
              ? texts.admin.common.saving
              : requirement === null
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={f.name} error={error ?? undefined}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        {requirement === null && (
          <FormField label={f.scope}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.scope}
                placeholder={f.scope}
                source={scopes}
                value={scope}
                onChange={(option) => {
                  const next = SCOPES.find((id) => id === option?.id);
                  if (next !== undefined) setScope(next);
                }}
              />
            )}
          </FormField>
        )}
        <FormField label={f.appliesTo}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              searchable={false}
              label={f.appliesTo}
              placeholder={f.appliesTo}
              source={applies}
              value={appliesTo}
              onChange={(option) => {
                const next = APPLIES.find((id) => id === option?.id);
                if (next !== undefined) setAppliesTo(next);
              }}
            />
          )}
        </FormField>
        <FormField label={f.validity} hint={f.validityHint}>
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              max={120}
              inputMode="numeric"
              value={validity}
              onChange={(event) => {
                setValidity(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={f.required}
          checked={required}
          onChange={(event) => {
            setRequired(event.target.checked);
          }}
        />
        {requirement !== null && <p className="text-xs text-muted-foreground">{f.archiveHint}</p>}
      </FormGrid>
    </DialogContent>
  );
}
