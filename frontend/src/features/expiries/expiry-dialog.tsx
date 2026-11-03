// The expiry of a file or a page (docs/spec/vencimientos.md): its badge, the dialog to set it and the
// prompt after a new version. The server checks who can set it; here a reader only sees it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Banner, Badge, Skeleton } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, Tooltip } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn, dayInputOf, formatUtcDate } from "@/lib/utils";
import {
  addDays,
  daysBetween,
  expiriesApi,
  expiriesKeys,
  type ExpiryState,
  type NodeExpiry,
} from "./expiries-api";
import { texts } from "@/i18n";

const t = texts.expiries;
const NOTICE_CHOICES = [60, 30, 15, 7, 1, 0] as const;

/** «Vence el …» in amber or «Venció el …» in red; nothing while it's valid and far. */
export function ExpiryBadge({
  dueOn,
  state,
  onClick,
  className,
}: {
  dueOn: string;
  state: ExpiryState;
  onClick?: () => void;
  className?: string;
}) {
  if (state === "valid") return null;
  const label =
    state === "expired"
      ? t.badge.expired(formatUtcDate(dueOn))
      : t.badge.dueSoon(formatUtcDate(dueOn));
  const badge = (
    <Badge
      tone={state === "expired" ? "danger" : "warning"}
      className={cn("shrink-0 gap-1", className)}
    >
      <CalendarClock className="size-3" strokeWidth={2} aria-hidden="true" />
      {label}
    </Badge>
  );
  if (onClick === undefined) return badge;
  return (
    <Tooltip content={t.badge.open}>
      <button
        type="button"
        aria-label={`${label}. ${t.badge.open}`}
        className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {badge}
      </button>
    </Tooltip>
  );
}

/** The expiry of the node, for a screen's badge (null while loading or without one). */
export function useNodeExpiry(nodeId: string | undefined) {
  const { workspaceSlug = "" } = useParams();
  return useQuery({
    queryKey: expiriesKeys.node(workspaceSlug, nodeId ?? ""),
    queryFn: () => expiriesApi.ofNode(workspaceSlug, nodeId ?? ""),
    enabled: nodeId !== undefined && nodeId !== "",
    staleTime: 30_000,
  });
}

/** Today in the company's zone. */
export function companyToday(): string {
  return dayInputOf(new Date().toISOString());
}

/** The same term as before, from today: today + (the old date − the day it was set). */
export function sameTermFrom(expiry: NodeExpiry, today = companyToday()): string {
  const term = Math.max(1, daysBetween(dayInputOf(expiry.setAt), expiry.dueOn));
  return addDays(today, term);
}

function useResponsibleSource(slug: string, nodeId: string): ComboboxSource {
  return useMemo(
    () => ({
      key: ["w", slug, "expiries", "responsible-options", nodeId],
      search: async (q, _cursor, signal) => {
        const options = await expiriesApi.responsibleOptions(slug, nodeId, q, signal);
        return {
          items: [
            ...options.people.map((person) => ({
              id: `person:${person.id}`,
              label: person.name,
              ...(person.canSee ? {} : { description: t.dialog.cantSee }),
            })),
            ...options.departments.map((department) => ({
              id: `department:${department.id}`,
              label: department.name,
              description: t.dialog.department,
            })),
          ],
          nextCursor: null,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [slug, nodeId],
  );
}

function parseResponsible(
  value: string | null,
): { type: "person" | "department"; id: string } | null {
  if (value === null) return null;
  const [type, id = ""] = value.split(":");
  if (type === "person") return { type: "person", id };
  if (type === "department") return { type: "department", id };
  return null;
}

/**
 * The dialog to see or set an element's expiry. `proposedDueOn` prefills the date (a new version
 * proposes the same term as before).
 */
export function ExpiryDialog({
  target,
  proposedDueOn,
  onClose,
}: {
  target: { id: string; name: string } | null;
  proposedDueOn?: string | undefined;
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
        <ExpiryDialogBody
          key={target.id}
          target={target}
          proposedDueOn={proposedDueOn}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ExpiryDialogBody({
  target,
  proposedDueOn,
  onClose,
}: {
  target: { id: string; name: string };
  proposedDueOn: string | undefined;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const current = useNodeExpiry(target.id);
  const expiry = current.data?.expiry ?? null;
  const canEdit = current.data?.canEdit === true;
  const [dueOn, setDueOn] = useState("");
  const [responsible, setResponsible] = useState<string | null>(null);
  const [responsibleLabel, setResponsibleLabel] = useState<string | undefined>(undefined);
  const [noticeDays, setNoticeDays] = useState<number[]>([30, 7, 0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loaded = current.data !== undefined;
  useEffect(() => {
    if (!loaded) return;
    setDueOn(proposedDueOn ?? expiry?.dueOn ?? "");
    setResponsible(
      expiry?.responsible == null ? null : `${expiry.responsible.type}:${expiry.responsible.id}`,
    );
    setResponsibleLabel(expiry?.responsible?.name);
    setNoticeDays(expiry?.noticeDays ?? [30, 7, 0]);
    setNote(expiry?.note ?? "");
    // Only when it loads: later edits are the person's.
  }, [loaded]);
  const source = useResponsibleSource(workspaceSlug, target.id);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: expiriesKeys.all(workspaceSlug) });
  const save = useMutation({
    mutationFn: () =>
      expiriesApi.set(workspaceSlug, target.id, {
        dueOn,
        responsible: parseResponsible(responsible),
        noticeDays,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: async (saved) => {
      await invalidate();
      toast.success(t.dialog.saved);
      const who = saved.expiry?.responsible;
      if (saved.expiry?.responsibleCantSee === true && who != null) {
        toast.warning(t.dialog.cantSeeWarning(who.name), { duration: 10_000 });
      }
      onClose();
    },
    onError: (err) => {
      toast.error(adminErrorText(err));
    },
  });
  const remove = useMutation({
    mutationFn: () => expiriesApi.remove(workspaceSlug, target.id),
    onSuccess: async () => {
      await invalidate();
      toast.success(t.dialog.removed);
      onClose();
    },
    onError: (err) => {
      toast.error(adminErrorText(err));
    },
  });
  const d = t.dialog;
  const busy = save.isPending || remove.isPending;
  return (
    <DialogContent
      title={d.title(target.name)}
      description={d.description}
      footer={
        canEdit ? (
          <>
            {expiry !== null && (
              <Button
                variant="ghost"
                className="text-danger sm:mr-auto"
                disabled={busy}
                onClick={() => {
                  remove.mutate();
                }}
              >
                {d.remove}
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {texts.common.cancel}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (!/^\d{4}-\d{2}-\d{2}$/u.test(dueOn)) {
                  setError(d.invalidDate);
                  return;
                }
                save.mutate();
              }}
            >
              {d.save}
            </Button>
          </>
        ) : undefined
      }
    >
      {current.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-20" />
        </div>
      ) : current.isError ? (
        <Banner tone="warning">{d.loadError}</Banner>
      ) : !canEdit ? (
        expiry === null ? (
          <p className="text-sm text-muted-foreground">{d.none}</p>
        ) : (
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{d.dueOn}</dt>
              <dd className="flex items-center gap-2 font-medium">
                {formatUtcDate(expiry.dueOn)}
                <Badge tone={toneOf(expiry.state)}>{t.states[expiry.state]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{d.responsible}</dt>
              <dd>{expiry.responsible?.name ?? d.responsiblePlaceholder}</dd>
            </div>
            {expiry.note !== null && (
              <div>
                <dt className="text-xs text-muted-foreground">{d.note}</dt>
                <dd className="whitespace-pre-wrap">{expiry.note}</dd>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{d.readOnly}</p>
          </dl>
        )
      ) : (
        <div className="grid gap-4">
          <FormField label={d.dueOn} error={error ?? undefined}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={dueOn}
                onChange={(event) => {
                  setDueOn(event.target.value);
                  setError(null);
                }}
              />
            )}
          </FormField>
          <FormField label={d.responsible}>
            {(field) => (
              <Combobox
                {...field}
                clearable
                label={d.responsible}
                placeholder={d.responsiblePlaceholder}
                source={source}
                value={responsible}
                valueLabel={responsibleLabel}
                onChange={(option) => {
                  setResponsible(option?.id ?? null);
                  setResponsibleLabel(option?.label);
                }}
              />
            )}
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{d.noticeDays}</legend>
            <div className="flex flex-wrap gap-2">
              {NOTICE_CHOICES.map((days) => {
                const on = noticeDays.includes(days);
                return (
                  <Button
                    key={days}
                    type="button"
                    size="sm"
                    variant={on ? "primary" : "outline"}
                    aria-pressed={on}
                    onClick={() => {
                      setNoticeDays((list) =>
                        on ? list.filter((value) => value !== days) : [...list, days],
                      );
                    }}
                  >
                    {d.notice(days)}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{d.noticeHint}</p>
          </fieldset>
          <FormField label={d.note}>
            {(field) => (
              <Textarea
                {...field}
                rows={3}
                maxLength={500}
                placeholder={d.notePlaceholder}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      )}
    </DialogContent>
  );
}

export function toneOf(state: ExpiryState): "success" | "warning" | "danger" {
  return state === "expired" ? "danger" : state === "due_soon" ? "warning" : "success";
}

/**
 * After a new version of a file with an expiry: offers the same term as before, from today. «Elegir otra
 * fecha» opens the dialog with it prefilled.
 */
export function NewVersionExpiryPrompt({
  target,
  onClose,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const current = useNodeExpiry(target?.id);
  const [choosing, setChoosing] = useState(false);
  const expiry = current.data?.canEdit === true ? (current.data.expiry ?? null) : null;
  const proposed = expiry === null ? undefined : sameTermFrom(expiry);
  const nothing = target !== null && current.data !== undefined && expiry === null;
  useEffect(() => {
    if (nothing) onClose();
  }, [nothing, onClose]);
  const update = useMutation({
    mutationFn: () =>
      expiriesApi.set(workspaceSlug, target?.id ?? "", {
        dueOn: proposed ?? "",
        responsible:
          expiry?.responsible == null
            ? null
            : { type: expiry.responsible.type, id: expiry.responsible.id },
        noticeDays: expiry?.noticeDays ?? [30, 7, 0],
        note: expiry?.note ?? null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: expiriesKeys.all(workspaceSlug) });
      toast.success(t.dialog.saved);
      onClose();
    },
    onError: (err) => {
      toast.error(adminErrorText(err));
    },
  });
  if (target === null || expiry === null || proposed === undefined) return null;
  if (choosing) {
    return (
      <ExpiryDialog
        target={target}
        proposedDueOn={proposed}
        onClose={() => {
          setChoosing(false);
          onClose();
        }}
      />
    );
  }
  const n = t.newVersion;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={n.title}
        footer={
          <>
            <Button variant="ghost" className="sm:mr-auto" onClick={onClose}>
              {n.keep}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setChoosing(true);
              }}
            >
              {n.other}
            </Button>
            <Button
              disabled={update.isPending}
              onClick={() => {
                update.mutate();
              }}
            >
              {n.update}
            </Button>
          </>
        }
      >
        <p className="text-sm">{n.text(formatUtcDate(expiry.dueOn), formatUtcDate(proposed))}</p>
      </DialogContent>
    </Dialog>
  );
}
