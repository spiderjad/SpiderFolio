// The whistleblowing channel in Security › General (docs/spec/canal-denuncias.md, «Activación»): only
// the owner, with two-step verification confirmed recently (the server asks for the code). On or off,
// who manages it and who is responsible for the system, the public link and the page's texts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Megaphone, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { COMBO_PAGE_SIZE, Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Badge, Banner, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { FormField, Input, Switch, Textarea } from "@/components/ui/form";
import { adminApi } from "@/features/admin/api";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ConfirmCodeDialog } from "@/features/profile/two-factor-section";
import { ApiError } from "@/lib/api";
import {
  channelApi,
  channelKeys,
  type ChannelManager,
  type ChannelSettingsInput,
} from "./whistleblowing-api";
import { texts } from "@/i18n";

const t = texts.whistleblowing.admin;
const RETENTION_MAX = 10;

type Pending =
  | { kind: "settings"; body: ChannelSettingsInput }
  | { kind: "managers"; managers: ChannelManager[] };

function usePeople(slug: string): ComboboxSource {
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", slug, "whistleblowing", "people-options"],
      search: async (q, cursor, signal) => {
        const page = await adminApi.directory(
          slug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((person) => ({ id: person.id, label: person.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [slug],
  );
}

export function ChannelAdminCard() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { reloadAccount } = useAuth();
  const people = usePeople(workspaceSlug);
  const settings = useQuery({
    queryKey: channelKeys.settings(workspaceSlug),
    queryFn: () => channelApi.settings(workspaceSlug),
    select: (data) => data.channel,
  });
  const [askCode, setAskCode] = useState<Pending | null>(null);
  const [external, setExternal] = useState<string | null>(null);
  const [retention, setRetention] = useState<string | null>(null);

  const onError = (pending: Pending) => (error: Error) => {
    if (error instanceof ApiError && error.code === "MFA_RECENT_REQUIRED") {
      setAskCode(pending);
      return;
    }
    toast.error(adminErrorText(error));
  };
  const done = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: channelKeys.all(workspaceSlug) });
    // The Channel area and the menu link come with the session's company data.
    await reloadAccount();
    toast.success(message);
  };
  const save = useMutation({
    mutationFn: (body: ChannelSettingsInput) => channelApi.saveSettings(workspaceSlug, body),
    onSuccess: async (_result, body) => {
      setExternal(null);
      setRetention(null);
      await done(body.enabled === true ? t.enabled : body.enabled === false ? t.disabled : t.saved);
    },
    onError: (error, body) => {
      onError({ kind: "settings", body })(error);
    },
  });
  const saveManagers = useMutation({
    mutationFn: (managers: ChannelManager[]) =>
      channelApi.saveManagers(
        workspaceSlug,
        managers.map((manager) => ({
          membershipId: manager.membershipId,
          responsible: manager.responsible,
        })),
      ),
    onSuccess: async () => {
      await done(t.saved);
    },
    onError: (error, managers) => {
      onError({ kind: "managers", managers })(error);
    },
  });

  const data = settings.data;
  const busy = save.isPending || saveManagers.isPending;
  const link = `${window.location.origin}/canal/${workspaceSlug}`;
  const setManagers = (managers: ChannelManager[]) => {
    // Exactly one responsible while there's anyone: the first one if none is marked.
    const fixed =
      managers.length > 0 && !managers.some((manager) => manager.responsible)
        ? managers.map((manager, index) => ({ ...manager, responsible: index === 0 }))
        : managers;
    saveManagers.mutate(fixed);
  };
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Megaphone className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 break-words">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.description}</p>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="mt-5 h-10 w-full max-w-sm" />
      ) : (
        <div className="mt-5 grid max-w-2xl gap-5">
          {!data.keyConfigured && <Banner tone="warning">{t.noKey}</Banner>}
          {!data.ownMfa && <Banner tone="warning">{t.needsMfa}</Banner>}
          <div className="flex items-start gap-3">
            <Switch
              aria-labelledby="channel-enabled-label"
              checked={data.enabled}
              disabled={busy || !data.ownMfa || (!data.enabled && !data.keyConfigured)}
              onCheckedChange={(enabled) => {
                save.mutate({ enabled });
              }}
            />
            <div>
              <p id="channel-enabled-label" className="text-sm font-medium">
                {t.enable}
              </p>
              <p className="text-xs text-muted-foreground">{t.enableHint}</p>
            </div>
          </div>

          <section className="grid gap-3">
            <div>
              <h3 className="text-sm font-semibold">{t.managers}</h3>
              <p className="text-xs text-muted-foreground">{t.managersHint}</p>
            </div>
            {data.managers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noManagers}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.managers.map((manager) => (
                  <li
                    key={manager.membershipId}
                    className="flex flex-wrap items-center gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {manager.name}
                        {manager.responsible && <Badge tone="primary">{t.responsible}</Badge>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{manager.email}</p>
                      {!manager.eligible && <p className="text-xs text-danger">{t.notEligible}</p>}
                    </div>
                    {!manager.responsible && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !data.ownMfa}
                        onClick={() => {
                          setManagers(
                            data.managers.map((entry) => ({
                              ...entry,
                              responsible: entry.membershipId === manager.membershipId,
                            })),
                          );
                        }}
                      >
                        {t.makeResponsible}
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`${t.remove}: ${manager.name}`}
                      disabled={busy || !data.ownMfa}
                      onClick={() => {
                        setManagers(
                          data.managers.filter(
                            (entry) => entry.membershipId !== manager.membershipId,
                          ),
                        );
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="max-w-sm">
              <Combobox
                label={t.add}
                placeholder={t.addPlaceholder}
                source={people}
                value={null}
                disabled={busy || !data.ownMfa}
                onChange={(option) => {
                  if (option === null) return;
                  if (data.managers.some((entry) => entry.membershipId === option.id)) return;
                  setManagers([
                    ...data.managers,
                    {
                      membershipId: option.id,
                      name: option.label,
                      email: "",
                      responsible: data.managers.length === 0,
                      eligible: true,
                    },
                  ]);
                }}
              />
            </div>
          </section>

          {data.enabled && (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t.link}</h3>
              <p className="text-xs text-muted-foreground">{t.linkHint}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 break-all rounded-md border border-border bg-muted px-2 py-1 text-xs">
                  {link}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(() => toast.success(t.copied));
                  }}
                >
                  <Copy className="size-4" aria-hidden="true" />
                  {t.copy}
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" aria-hidden="true" />
                    {t.open}
                  </a>
                </Button>
              </div>
            </section>
          )}

          <FormField label={t.externalChannels} hint={t.externalHint}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={4_000}
                disabled={!data.ownMfa}
                value={external ?? data.externalChannels}
                onChange={(event) => {
                  setExternal(event.target.value);
                }}
              />
            )}
          </FormField>
          <div className="flex flex-wrap items-end gap-2">
            <FormField label={t.retention} hint={t.retentionHint(RETENTION_MAX)}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={RETENTION_MAX}
                  className="w-28"
                  disabled={!data.ownMfa}
                  value={retention ?? String(data.retentionYears)}
                  onChange={(event) => {
                    setRetention(event.target.value);
                  }}
                />
              )}
            </FormField>
            <Button
              variant="outline"
              disabled={busy || !data.ownMfa || (external === null && retention === null)}
              onClick={() => {
                const years = Number.parseInt(retention ?? String(data.retentionYears), 10);
                save.mutate({
                  ...(external === null ? {} : { externalChannels: external }),
                  ...(retention === null || !Number.isInteger(years)
                    ? {}
                    : { retentionYears: Math.min(Math.max(years, 1), RETENTION_MAX) }),
                });
              }}
            >
              {t.save}
            </Button>
          </div>
        </div>
      )}
      {askCode !== null && (
        <ConfirmCodeDialog
          onClose={() => {
            setAskCode(null);
          }}
          onConfirmed={() => {
            const pending = askCode;
            setAskCode(null);
            if (pending.kind === "settings") save.mutate(pending.body);
            else saveManagers.mutate(pending.managers);
          }}
        />
      )}
    </Card>
  );
}
