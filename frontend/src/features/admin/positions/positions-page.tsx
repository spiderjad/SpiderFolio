// Administration › Positions (docs/spec/seguridad-salud.md, «Puestos»): the company's job positions,
// with how many people have each one. Whoever manages departments creates, renames and deletes them;
// a person's position is assigned when editing them in Members.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type SortState } from "@/components/ui/data-table";
import { Card, EmptyState } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminApi, adminKeys, type PositionQuery, type PositionView } from "../api";
import { adminErrorText, loadErrorIcon, loadErrorText } from "../admin-utils";
import { useCan } from "../guards";
import { readChoice, useListParams, useSearchParam } from "../list-params";
import { texts } from "@/i18n";

const PAGE_SIZE = 50;

export function PositionsPage() {
  const t = texts.admin.positions;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const canManage = useCan("departments.manage");
  const { params, patch } = useListParams();
  const query: PositionQuery = {
    q: params.get("q") ?? "",
    sort: readChoice(params, "sort", ["name", "people"] as const, "name"),
    dir: readChoice(params, "dir", ["asc", "desc"] as const, "asc"),
    pageSize: PAGE_SIZE,
  };
  const [search, setSearch] = useSearchParam("q", query.q ?? "", patch);
  const list = useInfiniteList<PositionView>({
    queryKey: [...adminKeys.positions(workspaceSlug), query],
    fetchPage: (cursor, signal) => adminApi.positions(workspaceSlug, { ...query, cursor }, signal),
  });
  const [editing, setEditing] = useState<PositionView | "new" | null>(null);
  const [deleting, setDeleting] = useState<PositionView | null>(null);
  const remove = useMutation({
    mutationFn: (position: PositionView) => adminApi.deletePosition(workspaceSlug, position.id),
    onSuccess: async () => {
      toast.success(t.toasts.deleted);
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      setDeleting(null);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const sort: SortState = { id: query.sort ?? "name", desc: query.dir === "desc" };
  const columns = useMemo<ColumnDef<PositionView>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            {row.original.description !== null && (
              <p className="truncate text-xs text-muted-foreground">{row.original.description}</p>
            )}
          </div>
        ),
      },
      {
        id: "people",
        header: t.columns.people,
        enableSorting: true,
        cell: ({ row }) =>
          row.original.people === 0 ? (
            <span className="text-muted-foreground">{t.nobody}</span>
          ) : (
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to={`/app/${workspaceSlug}/admin/members?position=${row.original.id}`}
            >
              {t.people(row.original.people)}
            </Link>
          ),
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">{t.columns.actions}</span>,
              cell: ({ row }: { row: { original: PositionView } }) => (
                <div className="flex justify-end gap-1">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.delete(row.original.name)}
                    onClick={() => {
                      setDeleting(row.original);
                    }}
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </div>
              ),
            } satisfies ColumnDef<PositionView>,
          ]
        : []),
    ],
    [t, workspaceSlug, canManage],
  );
  const filtered = query.q !== "";

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {canManage && (
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
      <SearchField
        placeholder={t.searchPlaceholder}
        label={texts.admin.common.search}
        value={search}
        onChange={setSearch}
      />
      {list.query.isError && list.query.data === undefined ? (
        <Card>
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
      ) : !list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title={filtered ? t.noResults : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(position) => position.id}
            loading={list.query.isPending}
            sort={sort}
            onSortChange={(next) => {
              patch({ sort: next.id, dir: next.desc ? "desc" : "asc" });
            }}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
          />
        </Card>
      )}
      <PositionFormDialog
        target={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        icon={Trash2}
        tone="destructive"
        title={t.deleteTitle(deleting?.name ?? "")}
        description={t.deleteText(deleting?.people ?? 0)}
        confirmLabel={texts.admin.common.delete}
        pendingLabel={t.deleting}
        onConfirm={async () => {
          if (deleting !== null) await remove.mutateAsync(deleting);
        }}
      />
    </div>
  );
}

function PositionFormDialog({
  target,
  onClose,
}: {
  target: PositionView | "new" | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && (
        <PositionForm
          key={target === "new" ? "new" : target.id}
          position={target === "new" ? null : target}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function PositionForm({
  position,
  onClose,
}: {
  position: PositionView | null;
  onClose: () => void;
}) {
  const t = texts.admin.positions;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [name, setName] = useState(position?.name ?? "");
  const [description, setDescription] = useState(position?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
      };
      return position === null
        ? adminApi.createPosition(workspaceSlug, body)
        : adminApi.updatePosition(workspaceSlug, position.id, body);
    },
    onSuccess: async () => {
      toast.success(position === null ? t.toasts.created : t.toasts.updated);
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  return (
    <DialogContent
      title={position === null ? t.form.createTitle : t.form.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={save.isPending || name.trim().length < 2}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending
              ? position === null
                ? texts.admin.common.creating
                : texts.admin.common.saving
              : position === null
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.form.name} hint={t.form.nameHint} error={error ?? undefined}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={80}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.form.description}>
          {(control) => (
            <Textarea
              {...control}
              value={description}
              rows={2}
              maxLength={200}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}
