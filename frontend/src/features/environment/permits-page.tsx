// /app/:slug/medio-ambiente/autorizaciones — permits and recurring obligations (docs/spec/medio-ambiente.md,
// section 1). environment.view reads them; environment.manage creates, edits, archives and marks
// obligations as done. Their expiries go through the expiry engine.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, FileBadge, Pencil, Plus, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Card, CardTitle, EmptyState } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import {
  PERMIT_KINDS,
  environmentApi,
  environmentKeys,
  type Obligation,
  type Permit,
} from "./environment-api";
import { DueDate, FolderLink, orNull, useEnvironment, usePeopleSource } from "./environment-common";
import { texts } from "@/i18n";

const t = texts.environment.permits;
const c = texts.environment.common;

function ArchivedToggle({
  archived,
  onChange,
}: {
  archived: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="v-segmented" role="tablist">
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          role="tab"
          aria-selected={archived === value}
          className="v-segmented__item"
          onClick={() => {
            onChange(value);
          }}
        >
          {value ? c.archived : c.active}
        </button>
      ))}
    </div>
  );
}

export function PermitsPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage } = useEnvironment();
  const [archived, setArchived] = useState(false);
  const [editingPermit, setEditingPermit] = useState<Permit | "new" | null>(null);
  const [editingObligation, setEditingObligation] = useState<Obligation | "new" | null>(null);
  const [completing, setCompleting] = useState<Obligation | null>(null);
  const permits = useQuery({
    queryKey: environmentKeys.permits(workspaceSlug, archived),
    queryFn: () => environmentApi.permits(workspaceSlug, archived),
    select: (data) => data.permits,
  });
  const obligations = useQuery({
    queryKey: environmentKeys.obligations(workspaceSlug, archived),
    queryFn: () => environmentApi.obligations(workspaceSlug, archived),
    select: (data) => data.obligations,
  });

  const permitColumns = useMemo<ColumnDef<Permit>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {[row.original.authority, row.original.owner?.name].filter(Boolean).join(" · ")}
            </span>
            <FolderLink folder={row.original.folder} />
          </div>
        ),
      },
      {
        id: "kind",
        header: t.columns.kind,
        cell: ({ row }) => texts.environment.permitKinds[row.original.kind],
      },
      {
        id: "reference",
        header: t.columns.reference,
        cell: ({ row }) => row.original.reference || c.none,
      },
      {
        id: "expires",
        header: t.columns.expires,
        cell: ({ row }) => <DueDate day={row.original.expiresOn ?? row.original.reviewOn} />,
      },
      ...(manage
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }: { row: { original: Permit } }) => (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`${c.edit}: ${row.original.name}`}
                  onClick={() => {
                    setEditingPermit(row.original);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              ),
            } satisfies ColumnDef<Permit>,
          ]
        : []),
    ],
    [manage],
  );

  const obligationColumns = useMemo<ColumnDef<Obligation>[]>(
    () => [
      {
        id: "name",
        header: t.obligationColumns.name,
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {[row.original.permit?.name, row.original.owner?.name].filter(Boolean).join(" · ")}
            </span>
          </div>
        ),
      },
      {
        id: "every",
        header: t.obligationColumns.every,
        cell: ({ row }) => t.every(row.original.everyMonths),
      },
      {
        id: "last",
        header: t.obligationColumns.last,
        cell: ({ row }) =>
          row.original.lastDoneOn === null ? c.none : formatUtcDate(row.original.lastDoneOn),
      },
      {
        id: "next",
        header: t.obligationColumns.next,
        cell: ({ row }) => <DueDate day={row.original.nextDueOn} warnDays={30} />,
      },
      ...(manage
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }: { row: { original: Obligation } }) => (
                <div className="flex justify-end gap-1">
                  {!row.original.archived && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCompleting(row.original);
                      }}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      {t.done}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`${c.edit}: ${row.original.name}`}
                    onClick={() => {
                      setEditingObligation(row.original);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ),
            } satisfies ColumnDef<Obligation>,
          ]
        : []),
    ],
    [manage],
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <ArchivedToggle archived={archived} onChange={setArchived} />
      </div>

      <Card className="grid gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <CardTitle>{t.permitsTitle}</CardTitle>
          {manage && !archived && (
            <Button
              size="sm"
              onClick={() => {
                setEditingPermit("new");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.new}
            </Button>
          )}
        </div>
        {!permits.isPending && (permits.data ?? []).length === 0 ? (
          <EmptyState icon={FileBadge} title={t.empty}>
            {null}
          </EmptyState>
        ) : (
          <DataTable
            label={t.permitsTitle}
            columns={permitColumns}
            data={permits.data ?? []}
            getRowId={(row) => row.id}
            loading={permits.isPending}
          />
        )}
      </Card>

      <Card className="grid gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <CardTitle>{t.obligationsTitle}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.obligationsHint}</p>
          </div>
          {manage && !archived && (
            <Button
              size="sm"
              onClick={() => {
                setEditingObligation("new");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.newObligation}
            </Button>
          )}
        </div>
        {!obligations.isPending && (obligations.data ?? []).length === 0 ? (
          <EmptyState icon={Repeat} title={t.emptyObligations}>
            {null}
          </EmptyState>
        ) : (
          <DataTable
            label={t.obligationsTitle}
            columns={obligationColumns}
            data={obligations.data ?? []}
            getRowId={(row) => row.id}
            loading={obligations.isPending}
          />
        )}
      </Card>

      {editingPermit !== null && (
        <PermitDialog
          permit={editingPermit === "new" ? undefined : editingPermit}
          onClose={() => {
            setEditingPermit(null);
          }}
        />
      )}
      {editingObligation !== null && (
        <ObligationDialog
          obligation={editingObligation === "new" ? undefined : editingObligation}
          permits={permits.data ?? []}
          onClose={() => {
            setEditingObligation(null);
          }}
        />
      )}
      {completing !== null && (
        <DoneDialog
          obligation={completing}
          onClose={() => {
            setCompleting(null);
          }}
        />
      )}
    </div>
  );
}

function useInvalidate() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: environmentKeys.all(workspaceSlug) });
  };
}

function DialogFooter({
  busy,
  ready,
  onSave,
  extra,
}: {
  busy: boolean;
  ready: boolean;
  onSave: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      {extra ?? <span />}
      <div className="flex gap-2">
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            {texts.admin.common.cancel}
          </Button>
        </DialogClose>
        <Button disabled={!ready || busy} onClick={onSave}>
          {busy ? texts.admin.common.saving : texts.admin.common.save}
        </Button>
      </div>
    </div>
  );
}

function PermitDialog({ permit, onClose }: { permit?: Permit | undefined; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const invalidate = useInvalidate();
  const people = usePeopleSource();
  const f = t.form;
  const kinds = useStaticSource(
    "environment-permit-kinds",
    PERMIT_KINDS.map((id) => ({ id, label: texts.environment.permitKinds[id] })),
  );
  const [state, setState] = useState({
    kind: permit?.kind ?? "ENVIRONMENTAL_LICENSE",
    name: permit?.name ?? "",
    authority: permit?.authority ?? "",
    reference: permit?.reference ?? "",
    issuedOn: permit?.issuedOn ?? "",
    expiresOn: permit?.expiresOn ?? "",
    reviewOn: permit?.reviewOn ?? "",
    conditions: permit?.conditions ?? "",
    owner: permit?.owner ?? null,
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const save = useMutation({
    mutationFn: (archived?: boolean) => {
      const body = {
        kind: state.kind,
        name: state.name.trim(),
        authority: state.authority.trim(),
        reference: state.reference.trim(),
        issuedOn: orNull(state.issuedOn),
        expiresOn: orNull(state.expiresOn),
        reviewOn: orNull(state.reviewOn),
        conditions: state.conditions.trim(),
        ownerId: state.owner?.id ?? null,
      };
      return permit === undefined
        ? environmentApi.createPermit(workspaceSlug, body)
        : environmentApi.updatePermit(workspaceSlug, permit.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
    },
    onSuccess: async () => {
      toast.success(permit === undefined ? c.created : c.saved);
      await invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = state.name.trim() !== "";
  const dateField = (label: string, key: "issuedOn" | "expiresOn" | "reviewOn", hint?: string) => (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <Input
          {...control}
          type="date"
          value={state[key]}
          onChange={(event) => {
            set({ [key]: event.target.value });
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
        size="lg"
        title={permit === undefined ? t.new : t.edit}
        footer={
          <DialogFooter
            busy={save.isPending}
            ready={ready}
            onSave={() => {
              save.mutate(undefined);
            }}
            extra={
              permit === undefined ? undefined : (
                <Button
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    save.mutate(!permit.archived);
                  }}
                >
                  {permit.archived ? c.restore : c.archive}
                </Button>
              )
            }
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.kind}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  searchable={false}
                  label={f.kind}
                  placeholder={f.kind}
                  source={kinds}
                  value={state.kind}
                  onChange={(option) => {
                    const kind = PERMIT_KINDS.find((id) => id === option?.id);
                    if (kind !== undefined) set({ kind });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.name}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={160}
                  value={state.name}
                  onChange={(event) => {
                    set({ name: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.authority}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={state.authority}
                  onChange={(event) => {
                    set({ authority: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.reference}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={state.reference}
                  onChange={(event) => {
                    set({ reference: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {dateField(f.issuedOn, "issuedOn")}
            {dateField(f.expiresOn, "expiresOn")}
            {dateField(f.reviewOn, "reviewOn", f.reviewHint)}
          </div>
          <FormField label={c.owner}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={c.owner}
                placeholder={c.ownerPlaceholder}
                source={people}
                value={state.owner?.id ?? null}
                valueLabel={state.owner?.name}
                onChange={(option) => {
                  set({ owner: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
          <FormField label={f.conditions}>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                maxLength={4000}
                value={state.conditions}
                onChange={(event) => {
                  set({ conditions: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ObligationDialog({
  obligation,
  permits,
  onClose,
}: {
  obligation?: Obligation | undefined;
  permits: Permit[];
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const invalidate = useInvalidate();
  const people = usePeopleSource();
  const f = t.obligationForm;
  const permitSource = useStaticSource(
    "environment-obligation-permits",
    permits.map((permit) => ({ id: permit.id, label: permit.name })),
  );
  const [state, setState] = useState({
    name: obligation?.name ?? "",
    permitId: obligation?.permit?.id ?? null,
    everyMonths: String(obligation?.everyMonths ?? 12),
    nextDueOn: obligation?.nextDueOn ?? "",
    owner: obligation?.owner ?? null,
    notes: obligation?.notes ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const months = Number.parseInt(state.everyMonths, 10);
  const save = useMutation({
    mutationFn: (archived?: boolean) => {
      const body = {
        name: state.name.trim(),
        permitId: state.permitId,
        everyMonths: months,
        nextDueOn: state.nextDueOn,
        ownerId: state.owner?.id ?? null,
        notes: state.notes.trim(),
      };
      return obligation === undefined
        ? environmentApi.createObligation(workspaceSlug, body)
        : environmentApi.updateObligation(workspaceSlug, obligation.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
    },
    onSuccess: async () => {
      toast.success(obligation === undefined ? c.created : c.saved);
      await invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready =
    state.name.trim() !== "" &&
    state.nextDueOn !== "" &&
    Number.isInteger(months) &&
    months >= 1 &&
    months <= 120;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={obligation === undefined ? t.newObligation : t.editObligation}
        footer={
          <DialogFooter
            busy={save.isPending}
            ready={ready}
            onSave={() => {
              save.mutate(undefined);
            }}
            extra={
              obligation === undefined ? undefined : (
                <Button
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    save.mutate(!obligation.archived);
                  }}
                >
                  {obligation.archived ? c.restore : c.archive}
                </Button>
              )
            }
          />
        }
      >
        <div className="grid gap-4">
          <FormField label={f.name}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                value={state.name}
                onChange={(event) => {
                  set({ name: event.target.value });
                }}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={f.everyMonths}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={120}
                  value={state.everyMonths}
                  onChange={(event) => {
                    set({ everyMonths: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.nextDueOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.nextDueOn}
                  onChange={(event) => {
                    set({ nextDueOn: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.permit}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  searchable={false}
                  label={f.permit}
                  placeholder={f.permitPlaceholder}
                  source={permitSource}
                  value={state.permitId}
                  onChange={(option) => {
                    set({ permitId: option?.id ?? null });
                  }}
                />
              )}
            </FormField>
          </div>
          <FormField label={c.owner}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={c.owner}
                placeholder={c.ownerPlaceholder}
                source={people}
                value={state.owner?.id ?? null}
                valueLabel={state.owner?.name}
                onChange={(option) => {
                  set({ owner: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
          <FormField label={f.notes}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={4000}
                value={state.notes}
                onChange={(event) => {
                  set({ notes: event.target.value });
                }}
              />
            )}
          </FormField>
          {obligation !== undefined && obligation.history.length > 0 && (
            <div className="grid gap-1">
              <p className="v-label">{t.history}</p>
              <ul className="grid gap-1 text-sm">
                {obligation.history.map((entry) => (
                  <li key={`${entry.doneOn}-${entry.by}-${entry.note}`}>
                    <span className="tabular-nums">{formatUtcDate(entry.doneOn)}</span> · {entry.by}
                    {entry.note !== "" && (
                      <span className="text-muted-foreground"> · {entry.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DoneDialog({ obligation, onClose }: { obligation: Obligation; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const invalidate = useInvalidate();
  const today = new Date().toISOString().slice(0, 10);
  const [doneOn, setDoneOn] = useState(today);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () =>
      environmentApi.completeObligation(workspaceSlug, obligation.id, {
        doneOn,
        note: note.trim(),
      }),
    onSuccess: async () => {
      toast.success(t.doneSaved);
      await invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.doneTitle}
        description={obligation.name}
        footer={
          <DialogFooter
            busy={save.isPending}
            ready={doneOn !== ""}
            onSave={() => {
              save.mutate();
            }}
          />
        }
      >
        <div className="grid gap-4">
          <FormField label={t.doneOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                max={today}
                value={doneOn}
                onChange={(event) => {
                  setDoneOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.doneNote} hint={t.doneNoteHint}>
            {(control) => (
              <Input
                {...control}
                maxLength={4000}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
