// /auditoria/:roomId — the external auditor (docs/spec/salas-de-auditoria.md): no account. They ask for a
// one-time code (it goes to the room's email), enter with it and see only the room: each item as a
// watermarked PDF in the viewer (and downloaded, if the room allows it). Outside the company's app.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FolderOpen, LogOut, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Banner, Card, EmptyState, Logo, Skeleton } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import { formatDateTime } from "@/lib/utils";
import { auditorApi, auditorKeys, auditorPdfUrl, type AuditorItem } from "./audit-rooms-api";
import { texts } from "@/i18n";

const t = texts.auditRooms.auditor;

export function AuditorPage() {
  const { roomId = "" } = useParams();
  const cover = useQuery({
    queryKey: auditorKeys.cover(roomId),
    queryFn: () => auditorApi.cover(roomId),
    retry: false,
  });
  if (cover.isPending) return <Skeleton className="m-6 h-64" />;
  if (cover.isError || !cover.data.room.open) {
    return (
      <AuthLayout title={t.title}>
        <Banner tone="warning">{t.closed}</Banner>
      </AuthLayout>
    );
  }
  const { room, signedIn } = cover.data;
  return signedIn ? (
    <Room roomId={roomId} company={room.company} />
  ) : (
    <SignIn roomId={roomId} company={room.company} name={room.name} until={room.expiresAt} />
  );
}

function SignIn({
  roomId,
  company,
  name,
  until,
}: {
  roomId: string;
  company: string;
  name: string;
  until: string;
}) {
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: () => auditorApi.requestCode(roomId),
    onSuccess: () => {
      setSent(true);
      setError(null);
      toast.success(t.codeSent);
    },
    onError: (failure) => {
      setError(failure instanceof ApiError ? errorText(failure) : String(failure));
    },
  });
  const enter = useMutation({
    mutationFn: () => auditorApi.enter(roomId, code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: auditorKeys.cover(roomId) });
    },
    onError: (failure) => {
      setCode("");
      setError(failure instanceof ApiError ? errorText(failure) : String(failure));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (/^\d{6}$/u.test(code)) enter.mutate();
  };
  return (
    <AuthLayout title={name} subtitle={`${t.from(company)} · ${t.until(formatDateTime(until))}`}>
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t.intro}</p>
        {error !== null && <FormAlert tone="danger">{error}</FormAlert>}
        {!sent ? (
          <Button
            size="lg"
            disabled={request.isPending}
            onClick={() => {
              request.mutate();
            }}
          >
            {t.requestCode}
          </Button>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <FormField label={t.code}>
              {(field) => (
                <Input
                  {...field}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replaceAll(/\D/gu, ""));
                  }}
                />
              )}
            </FormField>
            <Button type="submit" size="lg" disabled={code.length !== 6 || enter.isPending}>
              {t.enter}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={request.isPending}
              onClick={() => {
                request.mutate();
              }}
            >
              {t.resend}
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}

function Room({ roomId, company }: { roomId: string; company: string }) {
  const queryClient = useQueryClient();
  const items = useQuery({
    queryKey: auditorKeys.items(roomId),
    queryFn: () => auditorApi.items(roomId),
    retry: false,
  });
  const [viewing, setViewing] = useState<{ itemId: string; nodeId?: string; title: string } | null>(
    null,
  );
  const leave = useMutation({
    mutationFn: () => auditorApi.leave(roomId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: auditorKeys.cover(roomId) });
    },
  });
  const data = items.data;
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              leave.mutate();
            }}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t.leave}
          </Button>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:px-8">
        {items.isError ? (
          <Banner tone="warning">
            {items.error instanceof ApiError ? errorText(items.error) : t.closed}
          </Banner>
        ) : data === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{data.room.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.from(company)} · {t.until(formatDateTime(data.room.expiresAt))}
              </p>
            </div>
            <Banner tone="info" icon={ShieldCheck}>
              {t.readOnly}
            </Banner>
            {data.items.length === 0 ? (
              <Card>
                <EmptyState icon={FolderOpen} title={t.empty}>
                  {null}
                </EmptyState>
              </Card>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <ItemCard
                      item={item}
                      onOpen={(nodeId, title) => {
                        setViewing({
                          itemId: item.id,
                          title,
                          ...(nodeId === undefined ? {} : { nodeId }),
                        });
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      >
        {viewing !== null && (
          <DialogContent
            size="xl"
            title={viewing.title}
            footer={
              data?.room.allowDownload === true ? (
                <Button asChild variant="outline">
                  <a
                    href={auditorPdfUrl(roomId, viewing.itemId, {
                      nodeId: viewing.nodeId,
                      download: true,
                    })}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    {t.download}
                  </a>
                </Button>
              ) : undefined
            }
          >
            <iframe
              title={viewing.title}
              src={`${auditorPdfUrl(roomId, viewing.itemId, { nodeId: viewing.nodeId })}${
                data?.room.allowDownload === true ? "" : "#toolbar=0"
              }`}
              className="h-[75dvh] w-full rounded-lg border border-border"
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function ItemCard({
  item,
  onOpen,
}: {
  item: AuditorItem;
  onOpen: (nodeId: string | undefined, title: string) => void;
}) {
  const container = item.kind === "SPACE" || item.documents.length > 0;
  return (
    <Card className="grid gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 font-medium">
          {container ? (
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="truncate">{item.title}</span>
        </p>
        {item.unavailable ? (
          <span className="text-xs text-muted-foreground">{t.unavailable}</span>
        ) : container ? (
          <span className="text-xs text-muted-foreground">
            {t.documents(item.documents.length)}
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onOpen(undefined, item.title);
            }}
          >
            {t.open}
          </Button>
        )}
      </div>
      {!item.unavailable && container && item.documents.length > 0 && (
        <ul className="m-0 grid list-none divide-y divide-border p-0">
          {item.documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm">{document.name}</span>
                {document.path !== "" && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {document.path}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onOpen(document.id, document.name);
                }}
              >
                {t.open}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
