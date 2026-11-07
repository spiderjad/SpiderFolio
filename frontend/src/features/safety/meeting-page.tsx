// /app/:slug/seguridad/comite/reuniones/:meetingId — one committee meeting (docs/spec/seguridad-salud.md,
// «Consulta y participación»): attendees, agenda, the minutes and the agreements (planning measures with
// origin COMMITTEE). Whoever manages the module edits it; the committee's members read it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FilePlus2, FileText, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Dialog } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { NotFoundPage } from "@/features/home/not-found-page";
import { formatUtcDate } from "@/lib/utils";
import { ActionDialog } from "./action-dialog";
import { CommitteeNav, useCommitteeTerms } from "./committee-page";
import { MeetingDialog } from "./meetings-page";
import {
  committeeApi,
  committeeKeys,
  incidentsApi,
  incidentsKeys,
  type Meeting,
  type SafetyAction,
} from "./safety-api";
import { PpeTabs, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.meetings;
const p = texts.safety.planning;

function minutesHref(slug: string, minutes: NonNullable<Meeting["minutes"]>): string {
  const base = `/app/${slug}/files/${minutes.spaceId}`;
  // A page opens; a file, its folder.
  if (minutes.type === "PAGE") return `${base}/p/${minutes.id}`;
  return minutes.parentId === null ? base : `${base}/f/${minutes.parentId}`;
}

export function MeetingPage() {
  const { workspaceSlug = "", meetingId = "" } = useParams();
  const queryClient = useQueryClient();
  const { canManage } = useSafety();
  const terms = useCommitteeTerms();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<SafetyAction | "new" | null>(null);
  const query = useQuery({
    queryKey: committeeKeys.meeting(workspaceSlug, meetingId),
    queryFn: () => committeeApi.meeting(workspaceSlug, meetingId),
    select: (data) => data.meeting,
  });
  const agreements = useQuery({
    queryKey: committeeKeys.agreements(workspaceSlug, meetingId),
    queryFn: () => committeeApi.agreements(workspaceSlug, meetingId),
    select: (data) => data.items,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: incidentsKeys.all(workspaceSlug) });
  const done = useMutation({
    mutationFn: (id: string) => incidentsApi.done(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(texts.safety.incidents.toasts.done);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const minutes = useMutation({
    mutationFn: () => committeeApi.createMinutes(workspaceSlug, meetingId),
    onSuccess: async () => {
      toast.success(t.detail.minutesCreated);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (query.isError) return <NotFoundPage />;
  const meeting = query.data;
  const d = t.detail;
  const title =
    meeting === undefined ? t.title : d.title(t.kinds[meeting.kind], formatUtcDate(meeting.date));
  const agenda = (meeting?.agenda ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            to={`/app/${workspaceSlug}/seguridad/comite/reuniones`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            {d.back}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
        {meeting !== undefined && canManage && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {d.edit}
          </Button>
        )}
      </div>
      <PpeTabs />
      <CommitteeNav />
      {meeting === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="grid content-start gap-2 p-4 sm:p-5">
              <CardTitle className="text-base">{d.attendees}</CardTitle>
              {meeting.attendees.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.noAttendees}</p>
              ) : (
                <ul className="grid gap-1">
                  {meeting.attendees.map((person) => (
                    <li key={person.id} className="text-sm">
                      {person.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {terms.roles[person.role]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="grid content-start gap-2 p-4 sm:p-5">
              <CardTitle className="text-base">{d.agenda}</CardTitle>
              {agenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.noAgenda}</p>
              ) : (
                <ol className="grid list-decimal gap-1 pl-5 text-sm">
                  {agenda.map((line, index) => (
                    <li key={`${String(index)}-${line}`}>{line}</li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
          <Card className="grid gap-2 p-4 sm:p-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
              {d.minutes}
            </CardTitle>
            {meeting.minutes === null ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{d.noMinutes}</p>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={minutes.isPending}
                    onClick={() => {
                      minutes.mutate();
                    }}
                  >
                    <FilePlus2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    {d.createMinutes}
                  </Button>
                )}
              </div>
            ) : (
              <Link
                to={minutesHref(workspaceSlug, meeting.minutes)}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {meeting.minutes.name}
              </Link>
            )}
            <p className="text-xs text-muted-foreground">{d.by(meeting.createdBy.name)}</p>
          </Card>
          <Card className="grid gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{d.agreementsTitle}</CardTitle>
              {canManage && (
                <Button
                  size="sm"
                  onClick={() => {
                    setAdding("new");
                  }}
                >
                  <Plus strokeWidth={1.75} aria-hidden="true" />
                  {d.addAgreement}
                </Button>
              )}
            </div>
            {agreements.data === undefined ? (
              <Skeleton className="h-16 w-full" />
            ) : agreements.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">{d.noAgreements}</p>
            ) : (
              <ul className="divide-y divide-border">
                {agreements.data.map((action) => (
                  <li
                    key={action.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <p
                        className={
                          action.done === null
                            ? "text-sm font-medium"
                            : "text-sm text-muted-foreground line-through"
                        }
                      >
                        {action.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {action.responsible.name} · {formatUtcDate(action.dueOn)} ·{" "}
                        {p.priorities[action.priority]}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {action.done !== null && <Badge tone="success">{p.done}</Badge>}
                      {action.overdue && <Badge tone="danger">{p.overdue}</Badge>}
                      {action.done === null && action.canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={p.markDone}
                            disabled={done.isPending}
                            onClick={() => {
                              done.mutate(action.id);
                            }}
                          >
                            <CheckCircle2
                              className="size-4"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={p.edit(action.description)}
                            onClick={() => {
                              setAdding(action);
                            }}
                          >
                            <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Dialog open={editing} onOpenChange={setEditing}>
            {editing && (
              <MeetingDialog
                meeting={meeting}
                onClose={() => {
                  setEditing(false);
                }}
              />
            )}
          </Dialog>
          <Dialog
            open={adding !== null}
            onOpenChange={(open) => {
              if (!open) setAdding(null);
            }}
          >
            {adding !== null && (
              <ActionDialog
                {...(adding === "new"
                  ? {
                      from: {
                        origin: "COMMITTEE" as const,
                        meetingId: meeting.id,
                        label: title,
                      },
                    }
                  : { action: adding })}
                onClose={() => {
                  setAdding(null);
                }}
              />
            )}
          </Dialog>
        </>
      )}
    </div>
  );
}
