// /app/:slug/canal/:caseId — a whistleblowing case (docs/spec/canal-denuncias.md, «Ciclo de vida»):
// the report, the messages with the reporter, the internal notes, the decisions and the module's own
// log of who opened or changed it. Only managers who aren't excluded from it get here (404 otherwise).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert, UserMinus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn, formatDateTime } from "@/lib/utils";
import { CaseStatusBadge, DueText } from "./cases-page";
import {
  CASE_OUTCOMES,
  channelApi,
  channelKeys,
  type CaseAction,
  type CaseDetail,
  type CaseOutcome,
} from "./whistleblowing-api";
import { texts } from "@/i18n";

const t = texts.whistleblowing.case;
const w = texts.whistleblowing;
const MESSAGE_MAX = 5_000;

type Asking = "not_admit" | "close" | "extend" | "refer" | "affected_informed" | "recuse";

export function CasePage() {
  const { workspaceSlug = "", caseId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: channelKeys.case(workspaceSlug, caseId),
    queryFn: () => channelApi.case(workspaceSlug, caseId),
    select: (data) => data.case,
  });
  // Opening the case clears its «unread» on the server: the menu's count follows.
  const loaded = detail.data?.id;
  useEffect(() => {
    if (loaded !== undefined) {
      void queryClient.invalidateQueries({ queryKey: channelKeys.counts(workspaceSlug) });
    }
  }, [loaded, queryClient, workspaceSlug]);
  const [asking, setAsking] = useState<Asking | null>(null);
  const act = useMutation({
    mutationFn: (body: CaseAction) => channelApi.act(workspaceSlug, caseId, body),
    onSuccess: async (result, body) => {
      setAsking(null);
      await queryClient.invalidateQueries({ queryKey: channelKeys.all(workspaceSlug) });
      if (body.action === "recuse") {
        await navigate(`/app/${workspaceSlug}/canal`);
        return;
      }
      queryClient.setQueryData(channelKeys.case(workspaceSlug, caseId), result);
      toast.success(t.done);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const back = (
    <Link
      to={`/app/${workspaceSlug}/canal`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t.back}
    </Link>
  );
  if (detail.isError) {
    return (
      <div className="grid gap-4">
        {back}
        <Card>
          <EmptyState icon={ShieldAlert} title={adminErrorText(detail.error)}>
            {null}
          </EmptyState>
        </Card>
      </div>
    );
  }
  const data = detail.data;
  if (data === undefined) return <Skeleton className="h-96 w-full" />;
  const open =
    data.status === "RECEIVED" || data.status === "ADMITTED" || data.status === "INVESTIGATING";
  const busy = act.isPending;
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="tabular-nums">{data.code}</span>
            <CaseStatusBadge status={data.status} />
            {data.outcome !== null && <Badge>{w.outcomes[data.outcome]}</Badge>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.category} · {t.received} {formatDateTime(data.receivedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.status === "RECEIVED" && !data.purged && (
            <>
              <Button
                disabled={busy}
                onClick={() => {
                  act.mutate({ action: "admit" });
                }}
              >
                {t.actions.admit}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setAsking("not_admit");
                }}
              >
                {t.actions.notAdmit}
              </Button>
            </>
          )}
          {data.status === "ADMITTED" && (
            <Button
              disabled={busy}
              onClick={() => {
                act.mutate({ action: "investigate" });
              }}
            >
              {t.actions.investigate}
            </Button>
          )}
          {(data.status === "ADMITTED" || data.status === "INVESTIGATING") && (
            <Button
              variant={data.status === "INVESTIGATING" ? "primary" : "outline"}
              disabled={busy}
              onClick={() => {
                setAsking("close");
              }}
            >
              {t.actions.close}
            </Button>
          )}
        </div>
      </div>
      {data.purged && <Banner tone="info">{t.purged}</Banner>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Report data={data} />
          {data.decision !== null && (
            <Section title={t.decision}>
              <p className="whitespace-pre-line text-sm">{data.decision}</p>
            </Section>
          )}
          <Messages
            data={data}
            busy={busy}
            onSend={(body) => act.mutateAsync({ action: "message", body })}
          />
          <Notes
            data={data}
            busy={busy}
            onAdd={(body) => act.mutateAsync({ action: "note", body })}
          />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Section title={t.due}>
            <DueText dueOn={data.dueOn} status={data.status} />
            {data.extension !== null && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t.extension}: {data.extension}
              </p>
            )}
          </Section>
          {open && (
            <Instructor
              data={data}
              busy={busy}
              onChange={(membershipId) => {
                act.mutate({ action: "instructor", membershipId });
              }}
            />
          )}
          {open && (
            <Section title={texts.admin.common.actions}>
              <div className="grid gap-2">
                {data.extendedAt === null && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setAsking("extend");
                    }}
                  >
                    {t.actions.extend}
                  </Button>
                )}
                <Check
                  label={t.actions.refer}
                  at={data.referredAt}
                  disabled={busy}
                  onClick={() => {
                    setAsking("refer");
                  }}
                />
                <Check
                  label={t.actions.affected}
                  at={data.affectedInformedAt}
                  disabled={busy}
                  onClick={() => {
                    setAsking("affected_informed");
                  }}
                />
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setAsking("recuse");
                  }}
                >
                  <UserMinus className="size-4" aria-hidden="true" />
                  {t.actions.recuse}
                </Button>
              </div>
            </Section>
          )}
          {data.managers.some((manager) => manager.excluded) && (
            <Section title={t.excluded}>
              <ul className="grid gap-1 text-sm">
                {data.managers
                  .filter((manager) => manager.excluded)
                  .map((manager) => (
                    <li key={manager.membershipId}>{manager.name}</li>
                  ))}
              </ul>
            </Section>
          )}
          <Timeline data={data} />
        </div>
      </div>

      {(asking === "not_admit" || asking === "extend") && (
        <ReasonDialog
          title={asking === "not_admit" ? t.dialogs.notAdmitTitle : t.dialogs.extendTitle}
          hint={asking === "not_admit" ? t.dialogs.reasonHint : t.dialogs.extendHint}
          busy={busy}
          onClose={() => {
            setAsking(null);
          }}
          onConfirm={(reason) => {
            act.mutate(
              asking === "not_admit"
                ? { action: "not_admit", reason }
                : { action: "extend", reason },
            );
          }}
        />
      )}
      {asking === "close" && (
        <CloseDialog
          busy={busy}
          onClose={() => {
            setAsking(null);
          }}
          onConfirm={(outcome, summary) => {
            act.mutate({ action: "close", outcome, summary });
          }}
        />
      )}
      <ConfirmDialog
        open={asking === "refer" || asking === "affected_informed" || asking === "recuse"}
        onOpenChange={(value) => {
          if (!value) setAsking(null);
        }}
        icon={asking === "recuse" ? UserMinus : ShieldAlert}
        tone={asking === "recuse" ? "warning" : "primary"}
        title={
          asking === "refer"
            ? t.actions.refer
            : asking === "affected_informed"
              ? t.actions.affected
              : t.actions.recuse
        }
        description={
          asking === "refer"
            ? t.dialogs.referText
            : asking === "affected_informed"
              ? t.dialogs.affectedText
              : t.dialogs.recuseText
        }
        confirmLabel={t.dialogs.confirm}
        pendingLabel={texts.admin.common.saving}
        onConfirm={async () => {
          if (asking === "refer" || asking === "affected_informed" || asking === "recuse") {
            await act.mutateAsync({ action: asking }).catch(() => undefined);
          }
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="grid gap-2 p-4 sm:p-5">
      <CardTitle>{title}</CardTitle>
      {children}
    </Card>
  );
}

/** A record (referred, informed): a button until it's done, then the date. */
function Check({
  label,
  at,
  disabled,
  onClick,
}: {
  label: string;
  at: string | null;
  disabled: boolean;
  onClick: () => void;
}) {
  if (at !== null) {
    return (
      <p className="rounded-md border border-border px-3 py-2 text-sm">
        {label}
        <span className="block text-xs text-muted-foreground">{formatDateTime(at)}</span>
      </p>
    );
  }
  return (
    <Button variant="outline" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}

function Report({ data }: { data: CaseDetail }) {
  const report = data.report;
  if (report === null) return null;
  const field = (label: string, value: string) =>
    value.trim() === "" ? null : (
      <div className="grid gap-0.5">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="whitespace-pre-line text-sm">{value}</dd>
      </div>
    );
  return (
    <Section title={t.report}>
      <dl className="grid gap-3">
        {field(t.account, report.account)}
        {field(t.people, report.people)}
        {field(t.when, report.when)}
        {field(t.where, report.where)}
        <div className="grid gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{t.contact}</dt>
          <dd className="text-sm">
            {report.contact === null
              ? t.anonymous
              : [report.contact.name, report.contact.contact]
                  .filter((part) => part !== "")
                  .join(" · ")}
          </dd>
        </div>
      </dl>
    </Section>
  );
}

function Writer({
  label,
  hint,
  submit,
  busy,
  onSubmit,
}: {
  label: string;
  hint: string;
  submit: string;
  busy: boolean;
  onSubmit: (body: string) => Promise<unknown>;
}) {
  const [body, setBody] = useState("");
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === "") return;
        void onSubmit(body.trim()).then(
          () => {
            setBody("");
          },
          () => undefined,
        );
      }}
    >
      <FormField label={label} hint={hint}>
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            maxLength={MESSAGE_MAX}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
        )}
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy || body.trim() === ""}>
          {submit}
        </Button>
      </div>
    </form>
  );
}

function Messages({
  data,
  busy,
  onSend,
}: {
  data: CaseDetail;
  busy: boolean;
  onSend: (body: string) => Promise<unknown>;
}) {
  return (
    <Section title={t.messages}>
      {data.messages.length > 0 && (
        <ul className="grid gap-2">
          {data.messages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "grid max-w-[85%] gap-1 rounded-lg border border-border px-3 py-2",
                message.from === "MANAGEMENT" ? "justify-self-end bg-muted" : "justify-self-start",
              )}
            >
              <span className="text-xs text-muted-foreground">
                {message.from === "MANAGEMENT"
                  ? texts.whistleblowing.mailbox.fromManagement
                  : t.contact}{" "}
                · {formatDateTime(message.createdAt)}
              </span>
              <span className="whitespace-pre-line text-sm">{message.body}</span>
            </li>
          ))}
        </ul>
      )}
      {!data.purged && (
        <Writer
          label={t.messages}
          hint={t.messageHint}
          submit={t.send}
          busy={busy}
          onSubmit={onSend}
        />
      )}
    </Section>
  );
}

function Notes({
  data,
  busy,
  onAdd,
}: {
  data: CaseDetail;
  busy: boolean;
  onAdd: (body: string) => Promise<unknown>;
}) {
  return (
    <Section title={t.notes}>
      {data.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noNotes}</p>
      ) : (
        <ul className="grid gap-2">
          {data.notes.map((note) => (
            <li key={note.id} className="grid gap-0.5 border-l-2 border-border pl-3">
              <span className="text-xs text-muted-foreground">
                {note.author} · {formatDateTime(note.createdAt)}
              </span>
              <span className="whitespace-pre-line text-sm">{note.body}</span>
            </li>
          ))}
        </ul>
      )}
      {!data.purged && (
        <Writer
          label={t.addNote}
          hint={t.noteHint}
          submit={t.addNote}
          busy={busy}
          onSubmit={onAdd}
        />
      )}
    </Section>
  );
}

function Instructor({
  data,
  busy,
  onChange,
}: {
  data: CaseDetail;
  busy: boolean;
  onChange: (membershipId: string | null) => void;
}) {
  const source = useStaticSource(
    `channel-instructors-${data.id}`,
    data.managers
      .filter((manager) => !manager.excluded)
      .map((manager) => ({ id: manager.membershipId, label: manager.name })),
  );
  return (
    <Section title={t.instructor}>
      <Combobox
        searchable={false}
        clearable
        disabled={busy}
        label={t.instructor}
        placeholder={t.noInstructor}
        source={source}
        value={data.instructorId}
        onChange={(option) => {
          onChange(option?.id ?? null);
        }}
      />
    </Section>
  );
}

function Timeline({ data }: { data: CaseDetail }) {
  return (
    <Section title={t.timeline}>
      <ol className="grid gap-2 text-sm">
        {data.events.map((entry) => (
          <li key={entry.id} className="grid gap-0.5">
            <span>
              <span className="font-medium">{entry.who ?? t.system}</span>{" "}
              {(t.events as Record<string, string | undefined>)[entry.action] ?? entry.action}
            </span>
            <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function ReasonDialog({
  title,
  hint,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  hint: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        title={title}
        description={hint}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={busy || reason.trim() === ""}
              onClick={() => {
                onConfirm(reason.trim());
              }}
            >
              {t.dialogs.confirm}
            </Button>
          </>
        }
      >
        <FormField label={t.dialogs.reason}>
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={MESSAGE_MAX}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </FormField>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: (outcome: CaseOutcome, summary: string) => void;
}) {
  const outcomes = useStaticSource(
    "channel-outcomes",
    CASE_OUTCOMES.map((id) => ({ id, label: w.outcomes[id] })),
  );
  const [outcome, setOutcome] = useState<CaseOutcome | null>(null);
  const [summary, setSummary] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        title={t.dialogs.closeTitle}
        description={t.dialogs.summaryHint}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={busy || outcome === null || summary.trim() === ""}
              onClick={() => {
                if (outcome !== null) onConfirm(outcome, summary.trim());
              }}
            >
              {t.actions.close}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField label={t.dialogs.outcome}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={t.dialogs.outcome}
                placeholder={t.dialogs.outcome}
                source={outcomes}
                value={outcome}
                onChange={(option) => {
                  setOutcome(CASE_OUTCOMES.find((id) => id === option?.id) ?? null);
                }}
              />
            )}
          </FormField>
          <FormField label={t.dialogs.summary}>
            {(control) => (
              <Textarea
                {...control}
                rows={5}
                maxLength={MESSAGE_MAX}
                value={summary}
                onChange={(event) => {
                  setSummary(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
