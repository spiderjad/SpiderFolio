// Invitaciones pendientes (9.3): reenviar y revocar. Se ven con members.view o members.invite.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailPlus, Send } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { InfiniteList, useInfiniteList } from "@/components/ui/infinite";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SearchField } from "@/components/ui/filter-bar";
import { formatShortDate } from "@/lib/utils";
import { adminApi, adminKeys, type InvitationQuery, type InvitationView } from "../api";
import { adminErrorText, limitReachedOf, type LimitReachedDetails } from "../admin-utils";
import { invitationStatusChoices } from "../choices";
import { useCan } from "../guards";
import { readChoice, useListParams, useSearchParam } from "../list-params";
import { LimitReachedDialog } from "../limit-dialog";
import { texts } from "@/i18n";

export function InvitationsCard() {
  const t = texts.admin.invitations;
  const statusSource = useStaticSource("invitation-status", invitationStatusChoices);
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const canInvite = useCan("members.invite");
  const [revoking, setRevoking] = useState<InvitationView | null>(null);
  const [limit, setLimit] = useState<LimitReachedDetails | null>(null);

  // Página, búsqueda y estado van en la URL (prefijo "i") y los pagina el servidor.
  const { params, patch } = useListParams("ipage");
  const query: InvitationQuery = {
    q: params.get("iq") ?? "",
    status: readChoice<"" | "pending" | "expired">(params, "istatus", ["pending", "expired"], ""),
    pageSize: 10,
    sort: "createdAt",
    dir: "desc",
  };
  const [search, setSearch] = useSearchParam("iq", query.q, patch);
  const invitations = useInfiniteList<InvitationView>({
    queryKey: [...adminKeys.invitations(workspaceSlug), query],
    fetchPage: (cursor) => adminApi.invitations(workspaceSlug, { ...query, cursor }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });

  const resend = useMutation({
    mutationFn: (id: string) => adminApi.resendInvitation(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(t.resent);
      await refresh();
    },
    onError: (error) => {
      const reached = limitReachedOf(error);
      if (reached === null) toast.error(adminErrorText(error));
      else setLimit(reached);
    },
  });

  const list = invitations.items;
  const filtered = query.q !== "" || query.status !== "";
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-6 pt-5">
        <CardTitle className="text-base">{t.title}</CardTitle>
        {invitations.query.data !== undefined && invitations.total > 0 && (
          <Badge tone="primary">{invitations.total}</Badge>
        )}
      </div>
      {invitations.total > 0 || filtered ? (
        <div className="grid gap-3 px-6 pt-4 sm:grid-cols-[1fr_180px]">
          <SearchField
            placeholder={t.searchPlaceholder}
            label={texts.admin.common.search}
            value={search}
            onChange={setSearch}
          />
          <Combobox
            clearable
            searchable={false}
            label={t.statusFilter}
            placeholder={t.statuses.all}
            source={statusSource}
            value={query.status === "" ? null : query.status}
            onChange={(option) => {
              patch({ istatus: option?.id ?? "" });
            }}
          />
        </div>
      ) : null}
      {invitations.query.isPending ? (
        <div className="p-4 sm:p-5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={MailPlus}>{filtered ? t.noResults : t.empty}</EmptyState>
      ) : (
        <InfiniteList
          className="mt-2"
          label={t.title}
          items={list}
          getKey={(invitation) => invitation.id}
          paging={{
            total: invitations.total,
            hasNextPage: invitations.query.hasNextPage,
            isFetchingNextPage: invitations.query.isFetchingNextPage,
            onLoadMore: invitations.loadMore,
          }}
          maxHeightClass="max-h-[28rem]"
          renderItem={(invitation) => (
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{invitation.email}</p>
                <p className="text-xs text-muted-foreground">
                  {invitation.roleName} · {texts.admin.members.seat[invitation.seatType]} ·{" "}
                  {invitation.status === "expired"
                    ? t.expired
                    : `${t.columns.expires} ${formatShortDate(invitation.expiresAt)}`}
                  {invitation.invitedBy !== null && ` · ${t.columns.by} ${invitation.invitedBy}`}
                </p>
              </div>
              {canInvite && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resend.isPending}
                    onClick={() => {
                      resend.mutate(invitation.id);
                    }}
                    aria-label={`${t.resend}: ${invitation.email}`}
                  >
                    <Send strokeWidth={1.75} aria-hidden="true" />
                    {t.resend}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRevoking(invitation);
                    }}
                    aria-label={`${t.revoke}: ${invitation.email}`}
                  >
                    {t.revoke}
                  </Button>
                </div>
              )}
            </div>
          )}
        />
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        icon={MailPlus}
        title={revoking === null ? "" : t.confirmRevoke.title(revoking.email)}
        description={revoking === null ? "" : t.confirmRevoke.text(revoking.email)}
        confirmLabel={t.confirmRevoke.action}
        pendingLabel={t.confirmRevoke.pending}
        tone="destructive"
        onConfirm={async () => {
          if (revoking === null) return;
          await adminApi.revokeInvitation(workspaceSlug, revoking.id);
          toast.success(t.revoked);
          await refresh();
        }}
      />
      <LimitReachedDialog
        limit={limit}
        onClose={() => {
          setLimit(null);
        }}
      />
    </Card>
  );
}
