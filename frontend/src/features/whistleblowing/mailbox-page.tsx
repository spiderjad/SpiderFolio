// /canal/:workspaceSlug/buzon — the reporter's mailbox (docs/spec/canal-denuncias.md): the follow-up
// code and the password open it; it shows the case's status, the deadline, the decision and the
// messages with management, who sign as «the channel's management».
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Banner, Card, Skeleton } from "@/components/ui/display";
import { FormField, Input, PasswordInput, Textarea } from "@/components/ui/form";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import { cn, formatDateTime, formatUtcDate } from "@/lib/utils";
import { ChannelFrame } from "./channel-page";
import { reporterApi, reporterKeys, type Mailbox } from "./whistleblowing-api";
import { texts } from "@/i18n";

const t = texts.whistleblowing.mailbox;
const w = texts.whistleblowing;

export function MailboxPage() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const mailbox = useQuery({
    queryKey: reporterKeys.mailbox(workspaceSlug),
    queryFn: () => reporterApi.mailbox(workspaceSlug),
    select: (data) => data.mailbox,
    retry: false,
  });
  const leave = useMutation({
    mutationFn: () => reporterApi.logout(workspaceSlug),
    onSettled: () => {
      queryClient.removeQueries({ queryKey: reporterKeys.mailbox(workspaceSlug) });
      void mailbox.refetch();
    },
  });
  const data = mailbox.data;
  return (
    <ChannelFrame
      actions={
        data !== undefined ? (
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
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Link
          to={`/canal/${workspaceSlug}`}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t.back}
        </Link>
      </div>
      {mailbox.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : data === undefined ? (
        <SignIn slug={workspaceSlug} />
      ) : (
        <Case slug={workspaceSlug} data={data} />
      )}
    </ChannelFrame>
  );
}

function SignIn({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enter = useMutation({
    mutationFn: () => reporterApi.login(slug, code, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: reporterKeys.mailbox(slug) });
    },
    onError: (failed) => {
      setPassword("");
      setError(failed instanceof ApiError ? errorText(failed) : String(failed));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() !== "" && password !== "") enter.mutate();
  };
  return (
    <Card className="max-w-md p-4 sm:p-5">
      <form className="grid gap-4" onSubmit={submit}>
        <h2 className="text-base font-semibold">{t.signIn}</h2>
        {error !== null && (
          <p role="alert" className="v-banner v-banner--danger">
            {error}
          </p>
        )}
        <FormField label={t.code}>
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase tracking-widest"
              maxLength={40}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.password}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              maxLength={200}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          )}
        </FormField>
        <Button type="submit" disabled={enter.isPending || code.trim() === "" || password === ""}>
          {enter.isPending ? t.entering : t.enter}
        </Button>
      </form>
    </Card>
  );
}

const statusTone = {
  RECEIVED: "primary",
  ADMITTED: "primary",
  NOT_ADMITTED: "neutral",
  INVESTIGATING: "warning",
  CLOSED: "success",
} as const;

function Case({ slug, data }: { slug: string; data: Mailbox }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const write = useMutation({
    mutationFn: () => reporterApi.write(slug, body.trim()),
    onSuccess: (result) => {
      setBody("");
      queryClient.setQueryData(reporterKeys.mailbox(slug), result);
      toast.success(t.sent);
    },
    onError: (failed) => {
      toast.error(failed instanceof ApiError ? errorText(failed) : String(failed));
    },
  });
  const decided = data.status === "NOT_ADMITTED" || data.status === "CLOSED";
  return (
    <>
      <Card className="grid gap-2 p-4 sm:p-5">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{data.category}</span>
          <Badge tone={statusTone[data.status]}>{w.statuses[data.status]}</Badge>
          {data.outcome !== null && <Badge>{w.outcomes[data.outcome]}</Badge>}
        </p>
        <p className="text-sm text-muted-foreground">
          {t.received(formatDateTime(data.receivedAt))}
        </p>
        {!decided && (
          <p className="text-sm text-muted-foreground">{t.due(formatUtcDate(data.dueOn))}</p>
        )}
        {data.extended && !decided && <p className="text-sm">{t.extended}</p>}
      </Card>
      {data.purged && <Banner tone="info">{t.purged}</Banner>}
      {data.decision !== null && (
        <Card className="grid gap-1 p-4 sm:p-5">
          <h2 className="text-base font-semibold">
            {data.status === "NOT_ADMITTED" ? t.decisionNotAdmitted : t.decisionClosed}
          </h2>
          <p className="whitespace-pre-line text-sm">{data.decision}</p>
        </Card>
      )}
      <Card className="grid gap-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">{t.messages}</h2>
        {data.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noMessages}</p>
        ) : (
          <ul className="grid gap-2">
            {data.messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "grid max-w-[85%] gap-1 rounded-lg border border-border px-3 py-2",
                  message.from === "REPORTER" ? "justify-self-end bg-muted" : "justify-self-start",
                )}
              >
                <span className="text-xs text-muted-foreground">
                  {message.from === "REPORTER" ? t.fromMe : t.fromManagement} ·{" "}
                  {formatDateTime(message.createdAt)}
                </span>
                <span className="whitespace-pre-line text-sm">{message.body}</span>
              </li>
            ))}
          </ul>
        )}
        {!data.purged && (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (body.trim() !== "") write.mutate();
            }}
          >
            <FormField label={t.write}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={4}
                  maxLength={5_000}
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                  }}
                />
              )}
            </FormField>
            <div className="flex justify-end">
              <Button type="submit" disabled={write.isPending || body.trim() === ""}>
                {t.send}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
