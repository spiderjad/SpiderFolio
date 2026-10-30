// Admin › License and plugins (owner only): one compact list of the plugins on this server, each with
// what it needs (its license and when it expires, turning it on, its guide, removing it), uploading a
// signed plugin (.sfplugin) and the restart that loads or unloads them, and the company id the license
// is issued for. The server does every check, offline (docs/spec/plugins.md).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  KeyRound,
  MoreHorizontal,
  Puzzle,
  RotateCw,
  Search,
  ServerCrash,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ConfirmCodeDialog } from "@/features/profile/two-factor-section";
import { ApiError } from "@/lib/api";
import { pluginKeys } from "@/plugins/registry";
import { cn, formatDateTime, formatUtcDate } from "@/lib/utils";
import { pluginsUrl } from "@/lib/web-url";
import {
  licenseApi,
  licenseKeys,
  type InstalledPluginView,
  type LicenseOverview,
} from "./license-api";
import { texts } from "@/i18n";

const t = texts.license.license;

/** A license that expires within this many days is shown as about to expire. */
const EXPIRES_SOON_DAYS = 30;
/** From this many plugins on, the list gets a search box. */
const SEARCH_FROM = 8;

type MfaAction =
  { kind: "upload"; file: File } | { kind: "restart" } | { kind: "remove"; id: string };

export function LicensePage() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: licenseKeys.license(workspaceSlug),
    queryFn: () => licenseApi.overview(workspaceSlug),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: licenseKeys.license(workspaceSlug) });
    // The menu and the plugins' screens depend on what's active.
    await queryClient.invalidateQueries({ queryKey: pluginKeys.active(workspaceSlug) });
  };
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
        <Plugins data={data} slug={workspaceSlug} onChanged={refresh} />
      )}
    </div>
  );
}

function Plugins({
  data,
  slug,
  onChanged,
}: {
  data: LicenseOverview;
  slug: string;
  onChanged: () => Promise<void>;
}) {
  const { server, license } = data;
  const [query, setQuery] = useState("");
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [enabling, setEnabling] = useState<InstalledPluginView | null>(null);
  const [removing, setRemoving] = useState<InstalledPluginView | null>(null);
  const [askCode, setAskCode] = useState<MfaAction | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onMfa = (action: MfaAction) => (error: Error) => {
    if (error instanceof ApiError && error.code === "MFA_RECENT_REQUIRED") {
      setAskCode(action);
      return;
    }
    toast.error(adminErrorText(error));
  };
  const upload = useMutation({
    mutationFn: (file: File) => licenseApi.uploadPlugin(slug, file),
    onSuccess: async (result) => {
      const name = result.installed.find((plugin) => plugin.id === result.uploaded.id)?.name;
      toast.success(t.upload.uploaded(name ?? result.uploaded.id, result.uploaded.version));
      await onChanged();
    },
    onError: (error, file) => {
      onMfa({ kind: "upload", file })(error);
    },
  });
  const restart = useMutation({
    mutationFn: () => licenseApi.restart(slug),
    onSuccess: async () => {
      setConfirmRestart(false);
      await onChanged();
    },
    onError: (error) => {
      setConfirmRestart(false);
      onMfa({ kind: "restart" })(error);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => licenseApi.removePlugin(slug, id),
    onSuccess: async (_result, id) => {
      setRemoving(null);
      toast.success(t.removeDialog.done(data.installed.find((p) => p.id === id)?.name ?? id));
      await onChanged();
    },
    onError: (error, id) => {
      setRemoving(null);
      onMfa({ kind: "remove", id })(error);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      licenseApi.setActivation(slug, id, enabled, enabling?.id === id),
    onSuccess: async (_data, { enabled }) => {
      setEnabling(null);
      await onChanged();
      toast.success(enabled ? t.enabled : t.disabled);
    },
  });

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (words === "") return data.installed;
    return data.installed.filter((plugin) =>
      `${plugin.name} ${plugin.description}`.toLowerCase().includes(words),
    );
  }, [data.installed, query]);
  const pending = server.waiting.length + server.removing.length;

  return (
    <>
      {!server.ownMfa && server.uploadEnabled && (
        <Banner tone="warning">{t.upload.needsMfa}</Banner>
      )}
      {license.state === "invalid" && (
        <Banner
          tone="warning"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLicenseOpen(true);
              }}
            >
              {t.loadLicense}
            </Button>
          }
        >
          {license.reason === "workspace" ? t.invalidWorkspace : t.invalid}
        </Banner>
      )}
      {pending > 0 && (
        <Banner
          tone="info"
          icon={RotateCw}
          action={
            server.restartAt === null && server.restartSupported ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!server.ownMfa}
                onClick={() => {
                  setConfirmRestart(true);
                }}
              >
                {t.restart.now}
              </Button>
            ) : undefined
          }
        >
          {t.restart.waiting(pending)}{" "}
          {server.restartAt !== null
            ? t.restart.scheduled(formatDateTime(server.restartAt))
            : server.restartSupported
              ? ""
              : t.restart.manual}
        </Banner>
      )}

      <Card className="grid gap-0 p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Puzzle className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          <h2 className="font-medium">{t.pluginsTitle}</h2>
          <span className="text-xs text-muted-foreground">
            {t.count(shown.length, data.installed.length)}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {data.installed.length >= SEARCH_FROM && (
              <label className="relative">
                <span className="sr-only">{t.search}</span>
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  placeholder={t.search}
                  className="h-8 w-48 pl-8 text-sm"
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
              </label>
            )}
            {server.uploadEnabled && (
              <>
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
                    if (chosen !== null) upload.mutate(chosen);
                  }}
                />
                <Button
                  size="sm"
                  title={t.upload.hint}
                  disabled={!server.ownMfa || upload.isPending}
                  onClick={() => {
                    input.current?.click();
                  }}
                >
                  <Upload className="size-4" aria-hidden="true" />
                  {upload.isPending ? t.upload.uploading : t.upload.choose}
                </Button>
              </>
            )}
          </div>
        </div>
        {data.installed.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t.noPlugins}</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t.noMatches}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((plugin) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                data={data}
                busy={toggle.isPending}
                onLicense={() => {
                  setLicenseOpen(true);
                }}
                onToggle={() => {
                  if (plugin.enabled || plugin.distribution === "free") {
                    toggle.mutate(
                      { id: plugin.id, enabled: !plugin.enabled },
                      { onError: (error) => toast.error(adminErrorText(error)) },
                    );
                  } else {
                    setEnabling(plugin);
                  }
                }}
                onRemove={() => {
                  setRemoving(plugin);
                }}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <CompanyId id={data.workspaceId} />
          <a
            href={pluginsUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t.catalogLink}
          </a>
        </div>
      </Card>
      {server.multiCompany && (
        <p className="text-xs text-muted-foreground">{t.upload.multiCompany}</p>
      )}

      <LicenseDialog
        open={licenseOpen}
        onOpenChange={setLicenseOpen}
        slug={slug}
        hasLicense={license.state !== "none"}
        onChanged={onChanged}
      />
      <ConfirmDialog
        open={enabling !== null}
        onOpenChange={(open) => {
          if (!open) setEnabling(null);
        }}
        icon={ShieldAlert}
        tone="warning"
        title={t.community.confirmTitle(enabling?.name ?? "")}
        description={t.community.confirmText}
        confirmLabel={t.community.confirm}
        pendingLabel={t.community.enabling}
        onConfirm={async () => {
          if (enabling !== null) await toggle.mutateAsync({ id: enabling.id, enabled: true });
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        icon={Trash2}
        tone="destructive"
        title={t.removeDialog.title(removing?.name ?? "")}
        description={[
          t.removeDialog.text,
          server.restartSupported ? t.removeDialog.scheduled : t.removeDialog.manual,
          server.multiCompany ? t.removeDialog.multiCompany : "",
          removing?.distribution === "commercial" ? t.removeDialog.licenseKept : "",
        ]
          .filter((line) => line !== "")
          .join(" ")}
        confirmLabel={t.removeDialog.confirm}
        pendingLabel={t.removeDialog.pending}
        onConfirm={async () => {
          if (removing !== null) await remove.mutateAsync(removing.id).catch(() => undefined);
        }}
      />
      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        icon={RotateCw}
        tone="warning"
        title={t.restart.confirmTitle}
        description={t.restart.confirmText}
        confirmLabel={t.restart.confirm}
        pendingLabel={t.restart.scheduling}
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
            if (action.kind === "upload") upload.mutate(action.file);
            if (action.kind === "restart") restart.mutate();
            if (action.kind === "remove") remove.mutate(action.id);
          }}
        />
      )}
    </>
  );
}

/** Days from now until a date (rounded up); negative once it's past. */
const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

function PluginRow({
  plugin,
  data,
  busy,
  onLicense,
  onToggle,
  onRemove,
}: {
  plugin: InstalledPluginView;
  data: LicenseOverview;
  busy: boolean;
  onLicense: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { license, server } = data;
  const paid = plugin.distribution === "commercial";
  const replaced = plugin.replacedBy !== null;
  const removing = server.removing.includes(plugin.id);
  const waiting = server.waiting.some((entry) => entry.id === plugin.id);
  const removable = server.uploadEnabled && server.removable.includes(plugin.id) && !removing;
  // A paid plugin shows the company's license when it covers it.
  const covered =
    paid &&
    (license.state === "valid" || license.state === "expired") &&
    license.plugins?.includes(plugin.id) === true;
  const days =
    covered && license.expiresAt !== undefined && license.expiresAt !== null
      ? daysUntil(license.expiresAt)
      : null;
  const expired = covered && license.state === "expired";
  const soonDays = days !== null && days > 0 && days <= EXPIRES_SOON_DAYS ? days : null;
  const soon = soonDays !== null;

  const state = removing
    ? { label: t.pluginState.removing, tone: "warning" as const }
    : replaced
      ? { label: t.replacedBy(plugin.replacedBy ?? ""), tone: "neutral" as const }
      : plugin.active
        ? { label: t.pluginState.active, tone: "success" as const }
        : waiting
          ? { label: t.pluginState.waiting, tone: "primary" as const }
          : paid
            ? expired
              ? { label: t.pluginState.expired, tone: "danger" as const }
              : { label: t.pluginState.noLicense, tone: "neutral" as const }
            : { label: t.pluginState.off, tone: "neutral" as const };

  const canToggle = !paid && !replaced && !removing;
  return (
    <li className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium">{plugin.name}</span>
          <span className="text-xs text-muted-foreground">v{plugin.version}</span>
          <Badge tone={plugin.distribution === "community" ? "warning" : "neutral"}>
            {plugin.distribution === "community"
              ? t.badge.unverified
              : paid
                ? t.badge.paid
                : t.badge.free}
          </Badge>
          <Badge tone={state.tone}>{state.label}</Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground" title={plugin.description}>
          {replaced
            ? t.replacedHint(plugin.replacedBy ?? "")
            : plugin.distribution === "community"
              ? t.community.hint
              : plugin.description}
        </p>
        {paid && !replaced && (
          <p
            className={cn(
              "text-xs",
              expired
                ? "text-danger"
                : soon
                  ? "text-warning-soft-foreground"
                  : "text-muted-foreground",
            )}
          >
            {covered && license.id !== undefined ? (
              <>
                <KeyRound className="mr-1 inline size-3" aria-hidden="true" />
                {t.licenseLine(license.id)}
                {" · "}
                {license.expiresAt === null || license.expiresAt === undefined
                  ? t.noExpiry
                  : expired
                    ? t.expired(formatUtcDate(license.expiresAt))
                    : soonDays !== null
                      ? t.expiresSoon(soonDays)
                      : t.expires(formatUtcDate(license.expiresAt))}
              </>
            ) : (
              t.noLicense
            )}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {plugin.guide !== null && (
          <Button asChild size="sm" variant="ghost">
            <a href={plugin.guide} target="_blank" rel="noreferrer">
              {t.guide}
            </a>
          </Button>
        )}
        {paid && !replaced && (
          <Button
            size="sm"
            variant={expired || soon || !covered ? "primary" : "outline"}
            onClick={onLicense}
          >
            {covered ? t.renew : t.loadLicense}
          </Button>
        )}
        {canToggle && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onToggle}>
            {plugin.enabled ? t.disable : t.enable}
          </Button>
        )}
        {removable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t.more(plugin.name)}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-danger" onSelect={onRemove}>
                <Trash2 className="size-4" aria-hidden="true" />
                {t.remove}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

/** Paste a new license (all the company's paid plugins in one) or remove it. */
function LicenseDialog({
  open,
  onOpenChange,
  slug,
  hasLicense,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  hasLicense: boolean;
  onChanged: () => Promise<void>;
}) {
  const d = t.licenseDialog;
  const [token, setToken] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = useMutation({
    mutationFn: () => licenseApi.save(slug, token.trim()),
    onSuccess: async () => {
      toast.success(d.saved);
      setToken("");
      onOpenChange(false);
      await onChanged();
    },
    onError: (error) => toast.error(adminErrorText(error)),
  });
  const remove = useMutation({
    mutationFn: () => licenseApi.remove(slug),
    onSuccess: async () => {
      toast.success(d.removed);
      setConfirmRemove(false);
      onOpenChange(false);
      await onChanged();
    },
    onError: (error) => toast.error(adminErrorText(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() !== "") save.mutate();
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={d.title}
          description={d.text}
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              {hasLicense ? (
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => {
                    setConfirmRemove(true);
                  }}
                >
                  {d.removeLicense}
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                form="license-form"
                disabled={save.isPending || token.trim() === ""}
              >
                {save.isPending ? d.saving : d.save}
              </Button>
            </div>
          }
        >
          <form id="license-form" onSubmit={submit}>
            <FormField label={d.tokenLabel} hint={d.tokenHint}>
              {(control) => (
                <Textarea
                  {...control}
                  value={token}
                  rows={5}
                  spellCheck={false}
                  className="font-mono text-xs"
                  onChange={(event) => {
                    setToken(event.target.value);
                  }}
                />
              )}
            </FormField>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        icon={KeyRound}
        tone="destructive"
        title={d.removeTitle}
        description={d.removeText}
        confirmLabel={d.removeLicense}
        pendingLabel={d.removing}
        onConfirm={async () => {
          await remove.mutateAsync();
        }}
      />
    </>
  );
}

/** The id the license is issued for, small at the bottom: the owner sends it to SpiderJAD. */
function CompanyId({ id }: { id: string }) {
  const c = t.company;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2" title={c.hint}>
      <span>{c.label}:</span>
      <code className="font-mono text-foreground">{id}</code>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => {
          void navigator.clipboard.writeText(id).then(() => toast.success(c.copied));
        }}
      >
        <Copy className="size-3.5" aria-hidden="true" />
        {c.copy}
      </button>
    </p>
  );
}
