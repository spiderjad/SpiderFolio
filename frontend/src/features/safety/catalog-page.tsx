// /app/:slug/seguridad/epis/catalogo — the company's PPE (docs/spec/seguridad-salud.md, «EPIs»): how
// long each lasts (for the replacement notice), by size or not, and the positions that need it. Archived
// instead of deleted: earlier handouts keep pointing at it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { HardHat, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { Checkbox, FormField, FormGrid, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { usePositionSource } from "@/features/admin/sources";
import { safetyApi, safetyKeys, type SafetyItem } from "./safety-api";
import { PpeTabs, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.catalog;

export function CatalogPage() {
  const { workspaceSlug = "" } = useParams();
  const safety = useSafety();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const archived = params.get("archivados") === "1";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const list = useInfiniteList<SafetyItem>({
    queryKey: [...safetyKeys.items(workspaceSlug), { q, archived }],
    fetchPage: (cursor, signal) =>
      safetyApi.items(
        workspaceSlug,
        { q, cursor, pageSize: 50, status: archived ? "all" : "active" },
        signal,
      ),
  });
  const [editing, setEditing] = useState<SafetyItem | "new" | null>(null);
  const columns = useMemo<ColumnDef<SafetyItem>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 font-medium">
              {row.original.name}
              {row.original.hasSizes && <Badge>{t.sizes}</Badge>}
              {row.original.archived && <Badge tone="warning">{t.archived}</Badge>}
            </p>
            {row.original.category !== null && (
              <p className="truncate text-xs text-muted-foreground">{row.original.category}</p>
            )}
          </div>
        ),
      },
      {
        id: "life",
        header: t.columns.life,
        cell: ({ row }) =>
          row.original.lifeMonths === null ? (
            <span className="text-muted-foreground">{t.noLife}</span>
          ) : (
            t.life(row.original.lifeMonths)
          ),
      },
      {
        id: "positions",
        header: t.columns.positions,
        cell: ({ row }) =>
          row.original.positionIds.length === 0 ? (
            <span className="text-muted-foreground">{t.noPositions}</span>
          ) : (
            t.allPositions(row.original.positionIds.length)
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t.columns.actions}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.edit(row.original.name)}
              onClick={() => {
                setEditing(row.original);
              }}
            >
              <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );
  const filtered = q !== "";

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {t.subtitle(safety.terms.ppes)}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing("new");
          }}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t.create}
        </Button>
      </div>
      <PpeTabs />
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <SearchField
            placeholder={t.search}
            label={texts.admin.common.search}
            value={search}
            onChange={setSearch}
          />
        </div>
        <Checkbox
          label={t.showArchived}
          checked={archived}
          onChange={(event) => {
            patch({ archivados: event.target.checked ? "1" : undefined });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={HardHat} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
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
        </Card>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <ItemForm
            key={editing === "new" ? "new" : editing.id}
            item={editing === "new" ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function ItemForm({ item, onClose }: { item: SafetyItem | null; onClose: () => void }) {
  const f = t.form;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const positionSource = usePositionSource(workspaceSlug);
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [hasSizes, setHasSizes] = useState(item?.hasSizes ?? false);
  const [life, setLife] = useState(
    item?.lifeMonths === null || item === null ? "" : String(item.lifeMonths),
  );
  const [positionIds, setPositionIds] = useState<string[]>(item?.positionIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const done = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: safetyKeys.all(workspaceSlug) });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const months = Number.parseInt(life, 10);
      const body = {
        name: name.trim(),
        category: category.trim() === "" ? null : category.trim(),
        hasSizes,
        lifeMonths: Number.isInteger(months) && months > 0 ? months : null,
        positionIds,
      };
      return item === null
        ? safetyApi.createItem(workspaceSlug, body)
        : safetyApi.updateItem(workspaceSlug, item.id, body);
    },
    onSuccess: () => done(item === null ? t.toasts.created : t.toasts.updated),
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      safetyApi.updateItem(workspaceSlug, item?.id ?? "", { archived }),
    onSuccess: (_result, archived) => done(archived ? t.toasts.archived : t.toasts.restored),
    onError: (failure) => {
      toast.error(adminErrorText(failure));
    },
  });
  const busy = save.isPending || archive.isPending;
  return (
    <DialogContent
      title={item === null ? f.createTitle : f.editTitle}
      footer={
        <>
          {item !== null && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => {
                archive.mutate(!item.archived);
              }}
            >
              {item.archived ? f.restore : f.archive}
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={busy || name.trim().length < 2}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending
              ? texts.admin.common.saving
              : item === null
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
              maxLength={80}
              placeholder={f.namePlaceholder}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.category}>
          {(control) => (
            <Input
              {...control}
              value={category}
              maxLength={60}
              placeholder={f.categoryPlaceholder}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={f.hasSizes}
          checked={hasSizes}
          onChange={(event) => {
            setHasSizes(event.target.checked);
          }}
        />
        <FormField label={f.life} hint={f.lifeHint}>
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              max={120}
              inputMode="numeric"
              value={life}
              onChange={(event) => {
                setLife(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.positions} hint={f.positionsHint}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              multiple
              label={f.positions}
              placeholder={t.noPositions}
              source={positionSource}
              values={positionIds}
              onChange={setPositionIds}
            />
          )}
        </FormField>
        {item !== null && <p className="text-xs text-muted-foreground">{f.archiveHint}</p>}
      </FormGrid>
    </DialogContent>
  );
}
