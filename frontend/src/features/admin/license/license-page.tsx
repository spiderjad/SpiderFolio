// Admin › License and plugins (owner only): the license status, the plugins installed on this server,
// loading, replacing or removing the license, turning on community plugins, the company id the license
// is issued for, uploading a signed plugin (.sfplugin) and the restart that loads it. The server does
// every check, offline (docs/spec/plugins.md).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Copy,
  KeyRound,
  Puzzle,
  RotateCw,
  ServerCrash,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Textarea } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ConfirmCodeDialog } from "@/features/profile/two-factor-section";
import { ApiError } from "@/lib/api";
import { pluginKeys } from "@/plugins/registry";
import { formatDateTime, formatShortDate } from "@/lib/utils";
import { pluginsUrl } from "@/lib/web-url";
import {
  licenseApi,
  licenseKeys,
  type InstalledPluginView,
  type LicenseOverview,
} from "./license-api";
import { texts } from "@/i18n";

const t = texts.license.license;

export function LicensePage() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const overview = useQuery({
    queryKey: licenseKeys.license(workspaceSlug),
    queryFn: () => licenseApi.overview(workspaceSlug),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: licenseKeys.license(workspaceSlug) });
    // El menú y las pantallas de los plugins dependen de qué está activo.
    await queryClient.invalidateQueries({ queryKey: pluginKeys.active(workspaceSlug) });
  };
  const remove = useMutation({
    mutationFn: () => licenseApi.remove(workspaceSlug),
    onSuccess: async () => {
      setRemoving(false);
      await refresh();
      toast.success(t.removed);
    },
    onError: (error) => toast.error(adminErrorText(error)),
  });
  const data = overview.data;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      {overview.isError ? (
        <Card>
          <EmptyState icon={ServerCrash} title={t.loadError}>
            {adminErrorText(overview.error)}
          </EmptyState>
        </Card>
      ) : data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <LicenseCard
            data={data}
            onEdit={() => {
              setEditing(true);
            }}
            onRemove={() => {
              setRemoving(true);
            }}
          />
          {editing && (
            <LicenseForm
              slug={workspaceSlug}
              onDone={async () => {
                setEditing(false);
                await refresh();
              }}
              onCancel={() => {
                setEditing(false);
              }}
            />
          )}
          <CompanyCard id={data.workspaceId} />
          <PluginsCard data={data} slug={workspaceSlug} onChanged={refresh} />
          {data.server.uploadEnabled && (
            <UploadCard data={data} slug={workspaceSlug} onChanged={refresh} />
          )}
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            icon={KeyRound}
            tone="destructive"
            title={t.removeTitle}
            description={t.removeText}
            confirmLabel={t.remove}
            pendingLabel={t.saving}
            onConfirm={() => {
              remove.mutate();
            }}
          />
        </>
      )}
    </div>
  );
}

function LicenseCard({
  data,
  onEdit,
  onRemove,
}: {
  data: LicenseOverview;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { license } = data;
  const has = license.state !== "none";
  return (
    <Card className="grid gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <KeyRound
            className="mt-0.5 size-5 shrink-0 text-primary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0 break-words">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {t.status[license.state]}
              {license.id !== undefined && <Badge>{license.id}</Badge>}
            </CardTitle>
            {license.customer !== undefined && (
              <p className="text-sm text-muted-foreground">{t.customer(license.customer)}</p>
            )}
            {(license.state === "valid" || license.state === "expired") && (
              <p className="text-xs text-muted-foreground">
                {license.expiresAt === null || license.expiresAt === undefined
                  ? t.noExpiry
                  : t.expires(formatShortDate(license.expiresAt))}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {has && (
            <Button variant="outline" onClick={onRemove}>
              {t.remove}
            </Button>
          )}
          <Button onClick={onEdit}>{has ? t.replace : t.load}</Button>
        </div>
      </div>
      {license.state === "expired" && <Banner tone="warning">{t.expiredNote}</Banner>}
      {license.state === "invalid" && (
        <Banner tone="warning">
          {license.reason === "workspace" ? t.invalidWorkspace : t.invalidNote}
        </Banner>
      )}
    </Card>
  );
}

function LicenseForm({
  slug,
  onDone,
  onCancel,
}: {
  slug: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [token, setToken] = useState("");
  const save = useMutation({
    mutationFn: () => licenseApi.save(slug, token.trim()),
    onSuccess: async () => {
      toast.success(t.saved);
      await onDone();
    },
    onError: (error) => toast.error(adminErrorText(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() !== "") save.mutate();
  };
  return (
    <Card className="p-5">
      <form className="grid max-w-2xl gap-3" onSubmit={submit}>
        <FormField label={t.tokenLabel} hint={t.tokenHint}>
          {(control) => (
            <Textarea
              {...control}
              value={token}
              rows={4}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => {
                setToken(event.target.value);
              }}
            />
          )}
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending || token.trim() === ""}>
            {save.isPending ? t.saving : t.save}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PluginsCard({
  data,
  slug,
  onChanged,
}: {
  data: LicenseOverview;
  slug: string;
  onChanged: () => Promise<void>;
}) {
  const c = t.community;
  // Plugin community a activar: pide confirmar que no está verificado y tiene acceso al servidor.
  const [confirming, setConfirming] = useState<InstalledPluginView | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      licenseApi.setCommunity(slug, id, enabled),
    onSuccess: async (_data, { enabled }) => {
      setConfirming(null);
      await onChanged();
      toast.success(enabled ? c.enabled : c.disabled);
    },
  });
  return (
    <Card className="grid gap-3 p-5">
      <div className="flex items-center gap-2">
        <Puzzle className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <h2 className="font-medium">{t.pluginsTitle}</h2>
      </div>
      {data.installed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noPlugins}</p>
      ) : (
        <ul className="grid gap-2">
          {data.installed.map((plugin) => (
            <li
              key={plugin.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {plugin.name}{" "}
                  <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                  {plugin.distribution === "community" && (
                    <Badge tone="warning">{c.unverified}</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{plugin.description}</p>
                {plugin.distribution === "community" && (
                  <p className="text-xs text-muted-foreground">{c.hint}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={plugin.active ? "success" : "neutral"}>
                  {plugin.active
                    ? t.pluginState.active
                    : plugin.licensed
                      ? t.pluginState.licensed
                      : t.pluginState.inactive}
                </Badge>
                {plugin.distribution === "community" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggle.isPending}
                    onClick={() => {
                      if (plugin.active) {
                        toggle.mutate(
                          { id: plugin.id, enabled: false },
                          { onError: (error) => toast.error(adminErrorText(error)) },
                        );
                      } else {
                        setConfirming(plugin);
                      }
                    }}
                  >
                    {plugin.active ? c.disable : c.enable}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <a
        href={pluginsUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        {t.catalogLink}
      </a>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        icon={ShieldAlert}
        tone="warning"
        title={c.confirmTitle(confirming?.name ?? "")}
        description={c.confirmText}
        confirmLabel={c.confirm}
        pendingLabel={c.enabling}
        onConfirm={async () => {
          if (confirming !== null) {
            await toggle.mutateAsync({ id: confirming.id, enabled: true });
          }
        }}
      />
    </Card>
  );
}

/** The id the license is issued for: the owner sends it to SpiderJAD. */
function CompanyCard({ id }: { id: string }) {
  const c = t.company;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex min-w-0 items-start gap-3">
        <Building2
          className="mt-0.5 size-5 shrink-0 text-primary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0 break-words">
          <CardTitle className="text-base">{c.title}</CardTitle>
          <p className="font-mono text-sm">{id}</p>
          <p className="text-xs text-muted-foreground">{c.hint}</p>
        </div>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(id).then(() => toast.success(c.copied));
        }}
      >
        <Copy className="size-4" aria-hidden="true" />
        {c.copy}
      </Button>
    </Card>
  );
}

/**
 * Upload a signed plugin and restart to load it. Both need the owner's own two-step verification,
 * confirmed recently: on MFA_RECENT_REQUIRED the code is asked for and the action retried.
 */
function UploadCard({
  data,
  slug,
  onChanged,
}: {
  data: LicenseOverview;
  slug: string;
  onChanged: () => Promise<void>;
}) {
  const u = t.upload;
  const r = t.restart;
  const { server } = data;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [askCode, setAskCode] = useState<"upload" | "restart" | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const onMfa = (action: "upload" | "restart") => (error: Error) => {
    if (error instanceof ApiError && error.code === "MFA_RECENT_REQUIRED") {
      setAskCode(action);
      return;
    }
    toast.error(adminErrorText(error));
  };
  const upload = useMutation({
    mutationFn: (chosen: File) => licenseApi.uploadPlugin(slug, chosen),
    onSuccess: async (result) => {
      setFile(null);
      const name = result.installed.find((plugin) => plugin.id === result.uploaded.id)?.name;
      toast.success(u.uploaded(name ?? result.uploaded.id, result.uploaded.version));
      await onChanged();
    },
    onError: onMfa("upload"),
  });
  const restart = useMutation({
    mutationFn: () => licenseApi.restart(slug),
    onSuccess: async () => {
      setConfirmRestart(false);
      await onChanged();
    },
    onError: (error) => {
      setConfirmRestart(false);
      onMfa("restart")(error);
    },
  });
  const waiting = server.waiting
    .map(
      (plugin) =>
        `${data.installed.find((p) => p.id === plugin.id)?.name ?? plugin.id} ${plugin.version}`,
    )
    .join(", ");
  return (
    <Card className="grid gap-3 p-5">
      <div className="flex items-start gap-3">
        <Upload
          className="mt-0.5 size-5 shrink-0 text-primary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0 break-words">
          <CardTitle className="text-base">{u.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{u.text}</p>
        </div>
      </div>
      {server.multiCompany && <Banner tone="warning">{u.multiCompany}</Banner>}
      {!server.ownMfa && <Banner tone="warning">{u.needsMfa}</Banner>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".sfplugin"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            event.target.value = "";
            if (chosen === null) return;
            setFile(chosen);
            upload.mutate(chosen);
          }}
        />
        <Button
          disabled={!server.ownMfa || upload.isPending}
          onClick={() => {
            input.current?.click();
          }}
        >
          {upload.isPending ? u.uploading : u.choose}
        </Button>
        {file !== null && <span className="text-xs text-muted-foreground">{file.name}</span>}
      </div>
      <p className="text-xs text-muted-foreground">{u.communityNote}</p>
      {server.waiting.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <p className="text-sm">{r.waiting(waiting)}</p>
          {server.restartAt !== null ? (
            <p className="text-xs text-muted-foreground">
              {r.scheduled(formatDateTime(server.restartAt))}
            </p>
          ) : server.restartSupported ? (
            <div>
              <Button
                variant="outline"
                disabled={!server.ownMfa}
                onClick={() => {
                  setConfirmRestart(true);
                }}
              >
                <RotateCw className="size-4" aria-hidden="true" />
                {r.now}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{r.manual}</p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        icon={RotateCw}
        tone="warning"
        title={r.confirmTitle}
        description={r.confirmText}
        confirmLabel={r.confirm}
        pendingLabel={r.scheduling}
        onConfirm={async () => {
          await restart.mutateAsync().catch(() => undefined);
        }}
      />
      {askCode !== null && (
        <ConfirmCodeDialog
          onClose={() => {
            setAskCode(null);
          }}
          onConfirmed={() => {
            const action = askCode;
            setAskCode(null);
            if (action === "upload" && file !== null) upload.mutate(file);
            if (action === "restart") restart.mutate();
          }}
        />
      )}
    </Card>
  );
}
