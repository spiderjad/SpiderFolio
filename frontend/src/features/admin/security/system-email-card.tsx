// Security › Email: the server SMTP (SMTP_* in .env). Shows whether it works and the reason when it
// doesn't, and sends a test to the requester that shows the exact error. Read only: it's changed in
// the server's .env, never here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Banner, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { formatDateTime } from "@/lib/utils";
import { texts } from "@/i18n";
import { adminErrorText } from "../admin-utils";
import { adminApi, adminKeys, type SystemEmail, type SystemEmailTestResponse } from "../api";

type Failure = Extract<SystemEmailTestResponse["result"], { ok: false }>;

export function SystemEmailCard({ slug }: { slug: string }) {
  const t = texts.admin.security.email.system;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: adminKeys.systemEmail(slug),
    queryFn: () => adminApi.systemEmail(slug),
  });
  const [failure, setFailure] = useState<Failure | null>(null);
  const test = useMutation({
    mutationFn: () => adminApi.testSystemEmail(slug),
    onSuccess: ({ result, settings }) => {
      queryClient.setQueryData<SystemEmail>(adminKeys.systemEmail(slug), settings);
      if (result.ok) {
        setFailure(null);
        toast.success(t.testOk);
      } else {
        setFailure(result);
        toast.error(t.testFailed);
      }
    },
    onError: (error) => toast.error(adminErrorText(error)),
  });
  const data = query.data;

  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Server className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1 break-words">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.text}</p>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="mt-5 h-20 w-full max-w-xl" />
      ) : (
        <div className="mt-4 grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={data.status} />
            <span className="break-all text-muted-foreground">
              {t.server(data.host, data.port)}
            </span>
            <span className="break-all text-muted-foreground">{t.from(data.from)}</span>
          </div>
          {data.status.lastSuccessAt !== null && (
            <p className="text-xs text-muted-foreground">
              {t.lastSuccess(formatDateTime(data.status.lastSuccessAt))}
            </p>
          )}
          {data.status.failing && (
            <Banner>
              <div className="min-w-0 break-words text-sm">
                <p className="font-medium">
                  {texts.notifications.smtpReasons[data.status.lastErrorCode ?? "UNKNOWN"]}
                </p>
                {data.status.lastErrorAt !== null && (
                  <p>{t.failingSince(formatDateTime(data.status.lastErrorAt))}</p>
                )}
                <p className="mt-1">{t.failingHelp}</p>
              </div>
            </Banner>
          )}
          {failure !== null && <FailureDetail failure={failure} />}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={test.isPending}
              onClick={() => {
                test.mutate();
              }}
            >
              {t.test}
            </Button>
            <span className="text-xs text-muted-foreground">{t.testHint}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: SystemEmail["status"] }) {
  const t = texts.admin.security.email.system;
  if (status.failing) return <Badge tone="danger">{t.failing}</Badge>;
  if (status.lastSuccessAt !== null) return <Badge tone="success">{t.ok}</Badge>;
  return <Badge>{t.unknown}</Badge>;
}

/** The exact error of the last test, with the user and password masked by the server. */
function FailureDetail({ failure }: { failure: Failure }) {
  const t = texts.admin.security.email.system.detail;
  const code = [
    failure.smtpCode,
    failure.responseCode === null ? null : String(failure.responseCode),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <div
      role="alert"
      className="grid min-w-0 gap-1 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-soft-foreground"
    >
      <p>
        <span className="font-medium">{t.reason}:</span> {failure.message}
      </p>
      {code !== "" && (
        <p>
          <span className="font-medium">{t.code}:</span> <code className="font-mono">{code}</code>
        </p>
      )}
      {failure.response !== null && (
        <p className="min-w-0 break-words">
          <span className="font-medium">{t.response}:</span>{" "}
          <code className="font-mono text-xs">{failure.response}</code>
        </p>
      )}
    </div>
  );
}
