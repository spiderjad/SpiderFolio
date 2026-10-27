// Lecturas obligatorias de un documento controlado: «Leí y comprendo» para quien debe leerlo y, para
// quien lo gestiona, pedir la lectura a un departamento o una persona, ver el cumplimiento y
// exportarlo. La confirmación es siempre de la propia persona y por versión.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, BookCheck, Download, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COMBO_PAGE_SIZE, Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Skeleton } from "@/components/ui/display";
import { Checkbox, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { ComparisonLoader } from "./compare-view";
import { adminApi } from "@/features/admin/api";
import { adminErrorText, downloadTextFile } from "@/features/admin/admin-utils";
import { useDepartmentSource } from "@/features/admin/sources";
import { formatShortDate } from "@/lib/utils";
import {
  documentsApi,
  documentsKeys,
  type ControlledView,
  type ReadingStatus,
} from "./documents-api";
import { texts } from "@/i18n";

type GapSubject = { departmentId?: string; membershipId?: string; includeSubareas?: boolean };

/**
 * Aviso de quienes deben leer y no ven el documento, con el botón para darles acceso de lectura
 * (solo para quien gestiona los accesos). Sin sujeto, mira los requisitos que ya hay.
 */
function AccessGapNotice({
  nodeId,
  subject,
  onGranted,
}: {
  nodeId: string;
  subject?: GapSubject;
  onGranted?: () => Promise<unknown>;
}) {
  const t = texts.documents.readings.gap;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const key = [
    ...documentsKeys.node(workspaceSlug, nodeId),
    "readings",
    "gaps",
    subject?.departmentId ?? subject?.membershipId ?? "all",
    subject?.includeSubareas === true,
  ];
  const gaps = useQuery({
    queryKey: key,
    queryFn: () => documentsApi.accessGaps(workspaceSlug, nodeId, subject),
  });
  const data = gaps.data;
  if (data === undefined || data.total === 0) return null;
  return (
    <div
      role="status"
      className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {t.title(data.total)}
      </p>
      <p className="text-xs text-muted-foreground">{t.text}</p>
      <p className="break-words text-xs">
        {data.people.map((person) => person.name).join(", ")}
        {data.total > data.people.length && ` ${t.more(data.total - data.people.length)}`}
      </p>
      {data.canGrant ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t.grant}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t.noGrant}</p>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        icon={ShieldAlert}
        tone="warning"
        title={t.grantTitle(data.total)}
        description={t.grantText}
        confirmLabel={t.confirm}
        pendingLabel={t.pending}
        onConfirm={async () => {
          await documentsApi.grantReadingAccess(workspaceSlug, nodeId, subject ?? {});
          toast.success(t.done);
          setConfirming(false);
          await queryClient.invalidateQueries({
            queryKey: documentsKeys.node(workspaceSlug, nodeId),
          });
          await onGranted?.();
        }}
      />
    </div>
  );
}

const STATUS_TONE: Record<ReadingStatus, "success" | "warning" | "danger" | "neutral"> = {
  read: "success",
  pending: "warning",
  overdue: "danger",
  noAccess: "neutral",
};

const endOfDay = (value: string): string => new Date(`${value}T23:59:59`).toISOString();

export function ReadingsSection({
  nodeId,
  controlled,
  onChanged,
}: {
  nodeId: string;
  controlled: ControlledView;
  onChanged: () => Promise<unknown>;
}) {
  const t = texts.documents.readings;
  const { workspaceSlug = "" } = useParams();
  const { mine, canManage } = controlled.reading;
  const [requiring, setRequiring] = useState(false);
  const [viewing, setViewing] = useState(false);
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: [...documentsKeys.node(workspaceSlug, nodeId), "readings", "summary"],
    queryFn: () => documentsApi.readings(workspaceSlug, nodeId, undefined),
    enabled: canManage && controlled.publishedVersion !== null,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: documentsKeys.node(workspaceSlug, nodeId) });
    await onChanged();
  };
  const acknowledge = useMutation({
    mutationFn: () => documentsApi.acknowledge(workspaceSlug, nodeId),
    onSuccess: async () => {
      toast.success(t.acknowledged);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => documentsApi.removeReading(workspaceSlug, nodeId, id),
    onSuccess: async () => {
      toast.success(t.removed);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (controlled.publishedVersion === null) return null;
  const data = overview.data;
  return (
    <section className="grid gap-3 rounded-xl border border-border p-3" aria-label={t.title}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <BookCheck className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
        {t.title}
      </h3>
      {mine?.required === true &&
        (mine.acknowledged ? (
          <p className="text-sm text-success-soft-foreground">
            {t.mineDone(controlled.publishedVersion)}
          </p>
        ) : (
          <div className="grid gap-2 rounded-lg bg-primary-soft/40 p-3">
            {(mine.changeReason !== null || mine.readVersion !== null) && (
              <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
                {mine.changeReason !== null && (
                  <p className="text-sm">{t.reasonOfChange(mine.changeReason)}</p>
                )}
                {mine.readVersion !== null && (
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                      {t.whatChanged(mine.readVersion)}
                    </summary>
                    <div className="mt-2 max-h-72 overflow-y-auto">
                      <ComparisonLoader
                        nodeId={nodeId}
                        from={mine.readVersion}
                        to={controlled.publishedVersion}
                      />
                    </div>
                  </details>
                )}
              </div>
            )}
            <p className="text-sm font-medium">
              {t.mineTodo(controlled.publishedVersion)}
              {mine.dueAt !== null && ` · ${t.due(formatShortDate(mine.dueAt))}`}
            </p>
            <Button
              className="w-fit"
              disabled={acknowledge.isPending}
              onClick={() => {
                acknowledge.mutate();
              }}
            >
              {acknowledge.isPending ? t.acknowledging : t.acknowledge}
            </Button>
          </div>
        ))}
      {canManage && (
        <div className="grid gap-2">
          {overview.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : data === undefined ? null : (
            <>
              <p className="text-xs text-muted-foreground">
                {data.summary.total === 0 ? t.nobody : t.summary(data.summary, data.summary.total)}
              </p>
              {data.summary.noAccess > 0 && <AccessGapNotice nodeId={nodeId} />}
              {data.requirements.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {data.requirements.map((requirement) => (
                    <li
                      key={requirement.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-3 pr-1 text-sm"
                    >
                      {requirement.subject.name}
                      {requirement.includeSubareas && ` · ${t.subareas}`}
                      {requirement.dueAt !== null && ` · ${formatShortDate(requirement.dueAt)}`}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t.removeRequirement(requirement.subject.name)}
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(requirement.id);
                        }}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRequiring(true);
              }}
            >
              <UserPlus strokeWidth={1.75} aria-hidden="true" />
              {t.requireButton}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setViewing(true);
              }}
            >
              {t.compliance}
            </Button>
          </div>
        </div>
      )}
      {requiring && (
        <RequireDialog
          nodeId={nodeId}
          onClose={() => {
            setRequiring(false);
          }}
          onDone={async () => {
            setRequiring(false);
            await refresh();
          }}
        />
      )}
      {viewing && (
        <ComplianceDialog
          nodeId={nodeId}
          onClose={() => {
            setViewing(false);
          }}
        />
      )}
    </section>
  );
}

function RequireDialog({
  nodeId,
  onClose,
  onDone,
}: {
  nodeId: string;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const t = texts.documents.readings.require;
  const { workspaceSlug = "" } = useParams();
  const [kind, setKind] = useState<"department" | "person">("department");
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [subareas, setSubareas] = useState(false);
  const [due, setDue] = useState("");
  const departments = useDepartmentSource(workspaceSlug);
  const people = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "documents", "person-options"],
      search: async (q, cursor, signal) => {
        const page = await adminApi.directory(
          workspaceSlug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((p) => ({
            id: p.id,
            label: p.name,
            description: p.jobTitle ?? undefined,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
  const add = useMutation({
    mutationFn: () =>
      documentsApi.addReading(workspaceSlug, nodeId, {
        ...(kind === "department"
          ? { departmentId: picked?.id ?? "", includeSubareas: subareas }
          : { membershipId: picked?.id ?? "" }),
        dueAt: due === "" ? null : endOfDay(due),
      }),
    onSuccess: async () => {
      toast.success(texts.documents.readings.required);
      await onDone();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={t.text}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={add.isPending}>
              {texts.admin.common.cancel}
            </Button>
            <Button
              disabled={picked === null || add.isPending}
              onClick={() => {
                add.mutate();
              }}
            >
              {add.isPending ? t.sending : t.send}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div
            role="group"
            aria-label={t.title}
            className="inline-flex w-fit rounded-lg border border-border p-0.5"
          >
            {(["department", "person"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setPicked(null);
                }}
                className="h-8 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
              >
                {value === "department" ? t.department : t.person}
              </button>
            ))}
          </div>
          <Combobox
            key={kind}
            label={kind === "department" ? t.pickDepartment : t.pickPerson}
            placeholder={kind === "department" ? t.pickDepartment : t.pickPerson}
            source={kind === "department" ? departments : people}
            value={picked?.id ?? null}
            valueLabel={picked?.label}
            onChange={(option) => {
              setPicked(option === null ? null : { id: option.id, label: option.label });
            }}
          />
          {picked !== null && (
            <AccessGapNotice
              nodeId={nodeId}
              subject={
                kind === "department"
                  ? { departmentId: picked.id, includeSubareas: subareas }
                  : { membershipId: picked.id }
              }
            />
          )}
          {kind === "department" && (
            <Checkbox
              checked={subareas}
              label={texts.sharing.add.includeSubareas}
              onChange={(event) => {
                setSubareas(event.target.checked);
              }}
            />
          )}
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t.due}</span>
            <Input
              type="date"
              value={due}
              onChange={(event) => {
                setDue(event.target.value);
              }}
            />
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComplianceDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const t = texts.documents.readings.complianceDialog;
  const { workspaceSlug = "" } = useParams();
  const [status, setStatus] = useState<ReadingStatus | "">("");
  const [pages, setPages] = useState(1);
  const query = useQuery({
    queryKey: [...documentsKeys.node(workspaceSlug, nodeId), "readings", "people", status, pages],
    queryFn: async () => {
      // Se pide de a páginas y se juntan: la lista crece al pedir más.
      const items = [];
      let cursor: string | undefined;
      let total = 0;
      for (let page = 0; page < pages; page += 1) {
        const result = await documentsApi.readings(
          workspaceSlug,
          nodeId,
          status === "" ? undefined : status,
          cursor,
        );
        items.push(...result.people.items);
        total = result.people.total;
        cursor = result.people.nextCursor ?? undefined;
        if (cursor === undefined) break;
      }
      return { items, total };
    },
  });
  const remind = useMutation({
    mutationFn: (ids: string[] | undefined) =>
      documentsApi.remindReaders(workspaceSlug, nodeId, ids),
    onSuccess: (result) => {
      toast.success(texts.documents.readings.remind.sent(result.sent));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      downloadTextFile("lecturas.csv", await documentsApi.readingsCsv(workspaceSlug, nodeId));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              disabled={exportCsv.isPending}
              onClick={() => {
                exportCsv.mutate();
              }}
            >
              <Download strokeWidth={1.75} aria-hidden="true" />
              {t.export}
            </Button>
            <DialogClose asChild>
              <Button variant="outline">{texts.documents.dialog.close}</Button>
            </DialogClose>
          </>
        }
      >
        <div className="grid gap-3">
          <AccessGapNotice nodeId={nodeId} />
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t.filter}
              value={status}
              onChange={(event) => {
                const next = (["read", "pending", "overdue", "noAccess"] as const).find(
                  (value) => value === event.target.value,
                );
                setStatus(next ?? "");
                setPages(1);
              }}
              className="h-9 w-fit rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">{t.all}</option>
              {(["overdue", "pending", "read", "noAccess"] as const).map((value) => (
                <option key={value} value={value}>
                  {texts.documents.readings.status[value]}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={remind.isPending}
              onClick={() => {
                remind.mutate(undefined);
              }}
            >
              <BellRing strokeWidth={1.75} aria-hidden="true" />
              {texts.documents.readings.remind.all}
            </Button>
          </div>
          {query.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : query.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t.loadError}
            </p>
          ) : query.data.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.empty}</p>
          ) : (
            <ul className="m-0 max-h-80 list-none divide-y divide-border overflow-y-auto p-0">
              {query.data.items.map((person) => (
                <li key={person.membershipId} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {person.readAt !== null
                      ? formatShortDate(person.readAt)
                      : person.dueAt !== null
                        ? texts.documents.readings.due(formatShortDate(person.dueAt))
                        : ""}
                  </span>
                  <Badge tone={STATUS_TONE[person.status]}>
                    {texts.documents.readings.status[person.status]}
                  </Badge>
                  {(person.status === "pending" || person.status === "overdue") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={texts.documents.readings.remind.oneLabel(person.name)}
                      title={texts.documents.readings.remind.one}
                      disabled={remind.isPending}
                      onClick={() => {
                        remind.mutate([person.membershipId]);
                      }}
                    >
                      <BellRing className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {query.data !== undefined && query.data.items.length < query.data.total && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                setPages((current) => current + 1);
              }}
            >
              {texts.common.loadMore}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
