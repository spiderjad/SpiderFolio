// Administration › Audit rooms › a room (docs/spec/salas-de-auditoria.md): its auditor and expiry, what it
// shares (documents and folders come from the explorer's menu; reports are added here), the auditor's
// accesses, resending the link and revoking it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Mail, ServerCrash, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useMembership } from "@/features/home/workspace-layout";
import { trainingApi } from "@/features/safety/safety-api";
import { formatDateTime, formatShortDate } from "@/lib/utils";
import { roomsApi, roomsKeys, type RoomDetail, type RoomItemInput } from "./audit-rooms-api";
import { roomTone } from "./rooms-page";
import { texts } from "@/i18n";

const t = texts.auditRooms;

export function RoomPage() {
  const { workspaceSlug = "", roomId = "" } = useParams();
  const queryClient = useQueryClient();
  const room = useQuery({
    queryKey: roomsKeys.one(workspaceSlug, roomId),
    queryFn: () => roomsApi.get(workspaceSlug, roomId),
    select: (data) => data.room,
  });
  const [revoking, setRevoking] = useState(false);
  const refresh = (data: { room: RoomDetail }) => {
    queryClient.setQueryData(roomsKeys.one(workspaceSlug, roomId), data);
    return queryClient.invalidateQueries({ queryKey: roomsKeys.list(workspaceSlug) });
  };
  const resend = useMutation({
    mutationFn: () => roomsApi.resend(workspaceSlug, roomId),
    onSuccess: () => {
      toast.success(t.detail.resent);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => roomsApi.remove(workspaceSlug, roomId, itemId),
    onSuccess: async (data) => {
      toast.success(t.detail.removed);
      await refresh(data);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (room.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(room.error)}
        </EmptyState>
      </Card>
    );
  }
  const data = room.data;
  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  const d = t.detail;
  const open = data.state === "open";
  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4">
      <Link
        to={`/app/${workspaceSlug}/admin/audit-rooms`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {d.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {data.name}
            <Badge tone={roomTone[data.state]}>{t.states[data.state]}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {d.auditor(data.auditorEmail)} · {d.until(formatShortDate(data.expiresAt))} ·{" "}
            {data.allowDownload ? d.download : d.noDownload}
          </p>
          <p className="text-xs text-muted-foreground">{d.createdBy(data.createdBy.name)}</p>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={resend.isPending}
              onClick={() => {
                resend.mutate();
              }}
            >
              <Mail className="size-4" aria-hidden="true" />
              {d.resend}
            </Button>
            <Button
              variant="outline"
              className="text-danger"
              onClick={() => {
                setRevoking(true);
              }}
            >
              <Ban className="size-4" aria-hidden="true" />
              {d.revoke}
            </Button>
          </div>
        )}
      </div>
      {!open && <Banner tone="info">{d.closed}</Banner>}

      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle className="text-base">{d.shared}</CardTitle>
        {data.shared.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.noShared}</p>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-border p-0">
            {data.shared.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.report === null
                      ? t.kinds[item.kind === "SPACE" ? "SPACE" : "NODE"]
                      : ((t.kinds as Record<string, string>)[item.report] ?? item.report)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  aria-label={`${d.remove}: ${item.title}`}
                  onClick={() => {
                    remove.mutate(item.id);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {d.remove}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {open && <AddReport roomId={roomId} onAdded={refresh} />}
      </Card>

      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle className="text-base">{d.accesses}</CardTitle>
        {data.accesses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.noAccesses}</p>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-border p-0">
            {data.accesses.map((access) => (
              <li
                key={access.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2"
              >
                <span className="text-sm">
                  <span className="font-medium">
                    {(d.actions as Record<string, string>)[access.action] ?? access.action}
                  </span>
                  {access.what === null ? "" : ` · ${access.what}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(access.at)}
                  {access.ip === null ? "" : ` · ${d.ip(access.ip)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        icon={Ban}
        title={d.revokeTitle}
        description={d.revokeText}
        confirmLabel={d.revoke}
        pendingLabel={d.revoke}
        onConfirm={async () => {
          const result = await roomsApi.revoke(workspaceSlug, roomId);
          toast.success(d.revoked);
          await refresh(result);
          setRevoking(false);
        }}
      />
    </div>
  );
}

type ReportKind = "training" | "ppe" | "audit-log";

/** Reports that aren't about one document: a course's records, the PPE handouts, the audit log. */
function AddReport({
  roomId,
  onAdded,
}: {
  roomId: string;
  onAdded: (data: { room: RoomDetail }) => Promise<unknown>;
}) {
  const { workspaceSlug = "" } = useParams();
  const membership = useMembership();
  const can = (capability: string) => membership.capabilities.includes(capability);
  const safety = membership.workspace.safety.enabled && can("safety.manage");
  const kinds = [
    ...(safety ? (["training", "ppe"] as const) : []),
    ...(can("audit.view") ? (["audit-log"] as const) : []),
  ];
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const courses = useQuery({
    queryKey: ["w", workspaceSlug, "audit-rooms", "courses"],
    queryFn: ({ signal }) => trainingApi.list(workspaceSlug, undefined, signal),
    enabled: kind === "training",
  });
  const kindSource = useStaticSource(
    "audit-room-report",
    kinds.map((id) => ({ id, label: t.kinds[id] })),
  );
  const courseSource = useStaticSource(
    `audit-room-courses-${String(courses.dataUpdatedAt)}`,
    (courses.data?.items ?? []).map((course) => ({
      id: course.id,
      label: `${course.document.code} ${course.document.name}`,
    })),
  );
  const add = useMutation({
    mutationFn: () => {
      const body: RoomItemInput =
        kind === "training"
          ? { kind: "training", courseId: courseId ?? "" }
          : kind === "ppe"
            ? { kind: "ppe", from, to }
            : {
                kind: "audit-log",
                from,
                to,
                ...(action.trim() === "" ? {} : { action: action.trim() }),
              };
      return roomsApi.add(workspaceSlug, roomId, body);
    },
    onSuccess: async (data) => {
      toast.success(t.report.added);
      setKind(null);
      setCourseId(null);
      await onAdded(data);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const r = t.report;
  const ready =
    kind === "training"
      ? courseId !== null
      : kind !== null && from !== "" && to !== "" && from <= to;
  return (
    <div className="grid gap-3 border-t border-border pt-3">
      <p className="text-sm font-medium">{r.add}</p>
      {kinds.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <FormField label={r.kind}>
            {(field) => (
              <Combobox
                {...field}
                searchable={false}
                label={r.kind}
                placeholder={r.kind}
                source={kindSource}
                value={kind}
                onChange={(option) => {
                  setKind((option?.id as ReportKind | undefined) ?? null);
                }}
              />
            )}
          </FormField>
          {kind === "training" && (
            <FormField label={r.course}>
              {(field) => (
                <Combobox
                  {...field}
                  label={r.course}
                  placeholder={r.coursePlaceholder}
                  source={courseSource}
                  value={courseId}
                  onChange={(option) => {
                    setCourseId(option?.id ?? null);
                  }}
                />
              )}
            </FormField>
          )}
          {(kind === "ppe" || kind === "audit-log") && (
            <>
              <FormField label={r.from}>
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    value={from}
                    onChange={(event) => {
                      setFrom(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <FormField label={r.to}>
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    value={to}
                    onChange={(event) => {
                      setTo(event.target.value);
                    }}
                  />
                )}
              </FormField>
            </>
          )}
          {kind === "audit-log" && (
            <FormField label={r.action}>
              {(field) => (
                <Input
                  {...field}
                  maxLength={80}
                  placeholder={r.actionPlaceholder}
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value);
                  }}
                />
              )}
            </FormField>
          )}
          <div>
            <Button
              disabled={!ready || add.isPending}
              onClick={() => {
                add.mutate();
              }}
            >
              {r.save}
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{r.fromMenu}</p>
    </div>
  );
}
