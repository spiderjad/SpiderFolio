// In-person training signed on each attendee's own phone (docs/spec/seguridad-salud.md): the panel for
// whoever gave it (QR, link, who signed live, close) and the screen where each attendee signs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, ServerCrash, Smartphone } from "lucide-react";
import { useRef } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ApiError } from "@/lib/api";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import { trainingApi, trainingKeys, type SignSession } from "./safety-api";
import { texts } from "@/i18n";

const t = texts.safety.training;

/** While open, the list refreshes every few seconds: whoever gave it sees each signature come in. */
const LIVE_MS = 3000;

export function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(new Error("signature"));
    };
    reader.readAsDataURL(blob);
  });
}

function useSession(id: string | null) {
  const { workspaceSlug = "" } = useParams();
  return useQuery({
    queryKey: trainingKeys.session(workspaceSlug, id ?? ""),
    queryFn: () => trainingApi.session(workspaceSlug, id ?? ""),
    select: (data) => data.session,
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.session.open === true ? LIVE_MS : false),
    retry: false,
  });
}

/** The QR, the link and who signed, for whoever gave the training. */
export function SignSessionDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const session = useSession(id);
  const p = t.phone;
  const close = useMutation({
    mutationFn: () => trainingApi.closeSession(workspaceSlug, id ?? ""),
    onSuccess: async () => {
      toast.success(p.closed);
      await queryClient.invalidateQueries({ queryKey: trainingKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = session.data;
  const attendees = data?.attendees ?? [];
  const done = attendees.filter((attendee) => attendee.signedAt !== null).length;
  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {id !== null && (
        <DialogContent
          size="lg"
          title={p.title(
            data === undefined ? "" : `${data.course.code ?? ""} ${data.course.name}`.trim(),
          )}
          description={p.hint}
          footer={
            data?.open === true ? (
              <Button
                variant="outline"
                disabled={close.isPending}
                onClick={() => {
                  close.mutate();
                }}
              >
                {p.close}
              </Button>
            ) : undefined
          }
        >
          {data === undefined ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
              {data.share !== null ? (
                <div className="grid justify-items-center gap-2">
                  <img
                    src={data.share.qr}
                    alt={p.scan}
                    className="size-56 rounded-lg border border-border bg-white p-2"
                  />
                  <p className="max-w-56 text-center text-xs text-muted-foreground">{p.scan}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(data.share?.url ?? "").then(() => {
                        toast.success(p.copied);
                      });
                    }}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    {p.copy}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {p.expires(formatDateTime(data.expiresAt))}
                  </p>
                </div>
              ) : (
                <Banner tone="info">{t.sign.closed}</Banner>
              )}
              <div className="grid content-start gap-2">
                <p className="text-sm font-medium" aria-live="polite">
                  {p.signed(done, attendees.length)}
                </p>
                <ul className="m-0 grid list-none divide-y divide-border p-0">
                  {attendees.map((attendee) => (
                    <li
                      key={attendee.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span className="text-sm">{attendee.name}</span>
                      {attendee.signedAt === null ? (
                        <Badge tone="warning">{p.pending}</Badge>
                      ) : (
                        <Badge tone="success">
                          {p.signedAt(formatDateTime(attendee.signedAt))}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

/** A course's signings still open, to show their QR again. */
export function OpenSignSessions({
  courseId,
  onShow,
}: {
  courseId: string;
  onShow: (id: string) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const sessions = useQuery({
    queryKey: trainingKeys.sessions(workspaceSlug, courseId),
    queryFn: () => trainingApi.openSessions(workspaceSlug, courseId),
    select: (data) => data.items,
  });
  const items = sessions.data ?? [];
  if (items.length === 0) return null;
  const p = t.phone;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{p.openSessions}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((session) => {
          const done = (session.attendees ?? []).filter((a) => a.signedAt !== null).length;
          return (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="text-sm">
                {formatUtcDate(session.completedOn)} ·{" "}
                {p.signed(done, session.attendees?.length ?? 0)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onShow(session.id);
                }}
              >
                <Smartphone className="size-4" aria-hidden="true" />
                {p.show}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** /app/:slug/seguridad/firmar/:sessionId — where each attendee signs, on their own phone. */
export function SignSessionPage() {
  const { workspaceSlug = "", sessionId = "" } = useParams();
  const queryClient = useQueryClient();
  const session = useSession(sessionId);
  const read = useRef<(() => Promise<Blob | null>) | null>(null);
  const s = t.sign;
  const sign = useMutation({
    mutationFn: async () => {
      const blob = await read.current?.();
      if (blob == null) throw new Error(s.empty);
      return await trainingApi.sign(workspaceSlug, sessionId, await dataUrlOf(blob));
    },
    onSuccess: (result) => {
      queryClient.setQueryData(trainingKeys.session(workspaceSlug, sessionId), result);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? adminErrorText(error) : error.message);
    },
  });
  if (session.isError) {
    const forbidden = session.error instanceof ApiError && session.error.status === 403;
    return (
      <Card className="mx-auto w-full max-w-lg">
        <EmptyState icon={ServerCrash} title={s.title}>
          {forbidden ? s.notListed : adminErrorText(session.error)}
        </EmptyState>
      </Card>
    );
  }
  const data: SignSession | undefined = session.data;
  if (data === undefined) return <Skeleton className="mx-auto h-96 w-full max-w-lg" />;
  return (
    <div className="mx-auto grid w-full max-w-lg grid-cols-1 gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{s.title}</h1>
      <Card className="grid gap-1 p-4">
        <p className="text-xs text-muted-foreground">{s.course}</p>
        <p className="font-medium">
          {data.course.code === null ? "" : `${data.course.code} `}
          {data.course.name}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{s.date}</p>
        <p>{formatUtcDate(data.completedOn)}</p>
        <p className="mt-2 text-xs text-muted-foreground">{s.trainer}</p>
        <p>{data.trainer.name}</p>
      </Card>
      {data.me.signed ? (
        <Card className="flex items-start gap-3 p-4">
          <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden="true" />
          <p role="status">{sign.isSuccess ? s.done : s.already}</p>
        </Card>
      ) : !data.me.listed ? (
        <Banner tone="info">{data.attendees === null ? s.notListed : s.manager}</Banner>
      ) : !data.open ? (
        <Banner tone="warning">{s.closed}</Banner>
      ) : (
        <Card className="grid gap-3 p-4">
          <p className="text-sm">{s.statement}</p>
          <SignaturePad
            label={s.signature}
            register={(reader) => {
              read.current = reader;
            }}
          />
          <Button
            size="lg"
            disabled={sign.isPending}
            onClick={() => {
              sign.mutate();
            }}
          >
            {s.submit}
          </Button>
        </Card>
      )}
    </div>
  );
}
