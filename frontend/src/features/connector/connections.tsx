// Connected apps (docs/spec/conector-mcp.md): the person's own in My profile and every one in the
// company for the owner (Administration › Security), with «Disconnect»; the URL to paste in Claude; and
// the owner's switch to turn the connector off for the company.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Banner } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, Input, Switch } from "@/components/ui/form";
import { InfiniteList, useInfiniteList, type CursorPage } from "@/components/ui/infinite";
import { adminErrorText } from "@/features/admin/admin-utils";
import { texts } from "@/i18n";
import { api } from "@/lib/api";
import { formatDateTime, formatShortDate } from "@/lib/utils";

interface Connector {
  available: boolean;
  enabled: boolean;
  canWrite: boolean;
  url: string;
}

interface Connection {
  id: string;
  client: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  person?: { name: string; email: string | null };
}

interface Answer {
  connector: Connector;
  connections: CursorPage<Connection>;
}

/** `scope`: the person's own connections, or every one in the company (owner). */
export function ConnectedApps({ slug, scope }: { slug: string; scope: "mine" | "company" }) {
  const t = texts.connector;
  const queryClient = useQueryClient();
  const base = scope === "mine" ? `/w/${slug}/me/connections` : `/w/${slug}/admin/connections`;
  const queryKey = ["connector", slug, scope] as const;
  const connectorKey = ["connector", slug, "state"] as const;
  const [confirming, setConfirming] = useState<Connection | null>(null);
  const state = useQuery({
    queryKey: connectorKey,
    queryFn: async () => (await api<Answer>(`${base}?pageSize=1`)).connector,
  });
  const connector = state.data ?? null;
  const list = useInfiniteList<Connection>({
    queryKey,
    fetchPage: async (cursor, signal) =>
      (
        await api<Answer>(
          `${base}?pageSize=50${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
          { signal },
        )
      ).connections,
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirming(null);
      toast.success(t.profile.disconnected);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api<{ connector: Connector }>(`/w/${slug}/admin/connector`, {
        method: "PUT",
        body: { enabled },
      }),
    onSuccess: (answer) => {
      queryClient.setQueryData(connectorKey, answer.connector);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  return (
    <div className="grid gap-3">
      {connector !== null && !connector.available && (
        <Banner tone="info">
          {scope === "mine" ? t.profile.unavailable : t.admin.unavailable}
        </Banner>
      )}
      {connector?.available === true && scope === "company" && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.admin.enabled}</p>
              <p className="text-xs text-muted-foreground">{t.admin.enabledHint}</p>
            </div>
            <Switch
              aria-label={t.admin.enabled}
              checked={connector.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(enabled) => {
                toggle.mutate(enabled);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {connector.canWrite ? t.admin.writeOn : t.admin.readOnly}
          </p>
        </>
      )}
      {connector?.available === true && !connector.enabled && scope === "mine" && (
        <Banner tone="info">{t.profile.disabled}</Banner>
      )}
      {connector?.available === true && connector.enabled && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <FormField label={t.profile.urlLabel} hint={t.profile.urlHelp}>
            {(control) => (
              <Input {...control} readOnly className="font-mono text-xs" value={connector.url} />
            )}
          </FormField>
          <Button
            variant="outline"
            className="sm:mb-6"
            onClick={() => {
              void navigator.clipboard
                .writeText(connector.url)
                .then(() => toast.success(t.profile.copied));
            }}
          >
            <Copy className="size-4" aria-hidden="true" />
            {t.profile.copy}
          </Button>
        </div>
      )}
      {list.query.isSuccess && list.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {scope === "mine" ? t.profile.empty : t.admin.empty}
        </p>
      ) : (
        <InfiniteList
          items={list.items}
          getKey={(item) => item.id}
          label={t.profile.title}
          paging={{
            total: list.total,
            hasNextPage: list.query.hasNextPage,
            isFetchingNextPage: list.query.isFetchingNextPage,
            onLoadMore: list.loadMore,
          }}
          renderItem={(item) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Plug className="size-4 text-muted-foreground" aria-hidden="true" />
                  {item.client}
                  <Badge>
                    {item.scopes.includes("docs:write")
                      ? t.profile.scopes.write
                      : t.profile.scopes.read}
                  </Badge>
                </p>
                {item.person !== undefined && (
                  <p className="text-xs">
                    {t.admin.person}: {item.person.name}
                    {item.person.email === null ? "" : ` · ${item.person.email}`}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t.profile.connectedAt(formatShortDate(item.createdAt))} ·{" "}
                  {item.lastUsedAt === null
                    ? t.profile.neverUsed
                    : t.profile.lastUsed(formatDateTime(item.lastUsedAt))}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirming(item);
                }}
              >
                {t.profile.disconnect}
              </Button>
            </div>
          )}
        />
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        icon={Plug}
        tone="destructive"
        title={t.profile.confirmTitle(confirming?.client ?? "")}
        description={t.profile.confirmText}
        confirmLabel={t.profile.disconnect}
        pendingLabel={t.profile.disconnect}
        onConfirm={async () => {
          if (confirming !== null) await disconnect.mutateAsync(confirming.id);
        }}
      />
    </div>
  );
}
