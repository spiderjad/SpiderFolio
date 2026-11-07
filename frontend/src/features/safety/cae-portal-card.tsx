// «Acceso al portal» in a company's record (docs/spec/cae.md, «Portal de contratas»): whoever manages
// CAE gives the contractor a link with a code (the code is shown once, right here), sees when it was
// last used and revokes it. Giving a new code revokes the previous one.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Banner, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime } from "@/lib/utils";
import { portalHostApi, portalHostKeys, type CaePortalAccess } from "./cae-portal-api";
import { texts } from "@/i18n";

const t = texts.cae.portal;

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t.copied);
  } catch {
    // Without the clipboard (an insecure context): the text stays on screen to copy by hand.
  }
}

export function PortalCard({ companyId }: { companyId: string }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ access: CaePortalAccess; code: string } | null>(null);
  const access = useQuery({
    queryKey: portalHostKeys.access(workspaceSlug, companyId),
    queryFn: () => portalHostApi.access(workspaceSlug, companyId),
    select: (data) => data.access,
  });
  const revoke = useMutation({
    mutationFn: () => portalHostApi.revoke(workspaceSlug, companyId),
    onSuccess: async () => {
      toast.success(t.revoked);
      await queryClient.invalidateQueries({
        queryKey: portalHostKeys.access(workspaceSlug, companyId),
      });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = access.data;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <KeyRound
            className="mt-0.5 size-5 shrink-0 text-primary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <CardTitle className="text-base">{t.title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t.text}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setIssuing(true);
            }}
          >
            {data == null ? t.issue : t.reissue}
          </Button>
          {data != null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate();
              }}
            >
              {t.revoke}
            </Button>
          )}
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="h-10 w-full" />
      ) : data === null ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <div className="grid gap-1 text-sm">
          <p className="break-all font-medium">{data.url}</p>
          <p className="text-xs text-muted-foreground">
            {[
              t.createdBy(data.createdBy.name, formatDateTime(data.createdAt)),
              t.expiresAt(formatDateTime(data.expiresAt)),
              data.lastUsedAt === null ? t.neverUsed : t.lastUsed(formatDateTime(data.lastUsedAt)),
            ].join(" · ")}
          </p>
          {data.locked && <p className="text-sm text-danger">{t.locked}</p>}
          {data.expired && !data.locked && <p className="text-sm text-danger">{t.expired}</p>}
        </div>
      )}
      <Dialog
        open={issuing || issued !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIssuing(false);
            setIssued(null);
          }
        }}
      >
        {issued !== null ? (
          <IssuedDialog issued={issued} />
        ) : issuing ? (
          <IssueDialog
            companyId={companyId}
            onIssued={(result) => {
              setIssuing(false);
              setIssued(result);
            }}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

function IssueDialog({
  companyId,
  onIssued,
}: {
  companyId: string;
  onIssued: (result: { access: CaePortalAccess; code: string }) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [days, setDays] = useState("90");
  const [email, setEmail] = useState("");
  const issue = useMutation({
    mutationFn: () =>
      portalHostApi.issue(workspaceSlug, companyId, {
        days: Number.parseInt(days, 10),
        email: email.trim() === "" ? null : email.trim(),
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: portalHostKeys.access(workspaceSlug, companyId),
      });
      onIssued(result);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const valid = Number.isInteger(Number.parseInt(days, 10)) && Number.parseInt(days, 10) >= 1;
  return (
    <DialogContent
      title={t.issueTitle}
      description={t.issueHint}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={issue.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={!valid || issue.isPending}
            onClick={() => {
              issue.mutate();
            }}
          >
            {t.issue}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.days}>
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              inputMode="numeric"
              value={days}
              onChange={(event) => {
                setDays(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.email}>
          {(control) => (
            <Input
              {...control}
              type="email"
              maxLength={254}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

/** The link and the code, this once. */
function IssuedDialog({ issued }: { issued: { access: CaePortalAccess; code: string } }) {
  return (
    <DialogContent
      title={t.issued}
      footer={
        <DialogClose asChild>
          <Button>{t.done}</Button>
        </DialogClose>
      }
    >
      <FormGrid>
        <Banner tone="warning">{t.issuedHint}</Banner>
        {[
          { label: t.link, value: issued.access.url, mono: false },
          { label: t.code, value: issued.code, mono: true },
        ].map((item) => (
          <div key={item.label} className="grid gap-1">
            <p className="text-sm font-medium">{item.label}</p>
            <div className="flex items-center gap-2">
              <code
                className={
                  item.mono
                    ? "min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-lg tracking-widest"
                    : "min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm"
                }
              >
                {item.value}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label={t.copy(item.label)}
                onClick={() => {
                  void copy(item.value);
                }}
              >
                <Copy className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
      </FormGrid>
    </DialogContent>
  );
}
