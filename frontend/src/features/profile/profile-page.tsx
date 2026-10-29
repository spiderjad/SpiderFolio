// /app/:slug/profile — «Mi perfil»: nombre, puesto, email, contraseña, sesiones abiertas y tema.
// Quien entra con usuario y PIN (lector de planta) solo ve su nombre y el tema.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { ConnectedApps } from "@/features/connector/connections";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { adminErrorText, loadErrorText } from "@/features/admin/admin-utils";
import { api, ApiError } from "@/lib/api";
import { getThemePreference, setThemePreference, type ThemePreference } from "@/lib/theme";
import { formatDateTime } from "@/lib/utils";
import { ProfileCard } from "./profile-card";
import { ConfirmCodeDialog, TwoFactorSection } from "./two-factor-section";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { isLocale, LOCALE_NAMES, LOCALES, switchLocale, texts } from "@/i18n";

interface SessionView {
  id: string;
  device: string;
  ip: string | null;
  signedInAt: string;
  lastUsedAt: string;
  current: boolean;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="grid gap-4 p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description !== undefined && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </Card>
  );
}

export function ProfilePage() {
  const t = texts.profile;
  const { workspaceSlug = "" } = useParams();
  const { account } = useAuth();
  const membership = account?.memberships.find((m) => m.workspace.slug === workspaceSlug);
  if (account === null || membership === undefined) return null;
  const isPin = account.user.kind === "PIN";
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-4 lg:sticky lg:top-20">
          <ProfileCard account={account} membership={membership} />
          <ThemeSection />
          <LanguageSection companyName={membership.workspace.name} />
        </div>
        <div className="grid min-w-0 gap-4">
          <DetailsSection
            name={account.user.name}
            jobTitle={membership.jobTitle ?? ""}
            showJobTitle={!isPin}
          />
          {!isPin && (
            <EmailSection
              email={account.user.email ?? ""}
              pending={account.user.pendingEmail}
              verified={account.user.emailVerified}
            />
          )}
          {!isPin && <PasswordSection />}
          {!isPin && <TwoFactorSection />}
          {!isPin && <SessionsSection />}
          {!isPin && membership.role.base !== "GUEST" && (
            <Section
              title={texts.connector.profile.title}
              description={texts.connector.profile.text}
            >
              <ConnectedApps slug={workspaceSlug} scope="mine" />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Nombre y puesto ─────────────────────────────────────────────────────────────────────

function DetailsSection({
  name: initialName,
  jobTitle: initialJobTitle,
  showJobTitle,
}: {
  name: string;
  jobTitle: string;
  showJobTitle: boolean;
}) {
  const t = texts.profile.details;
  const { workspaceSlug = "" } = useParams();
  const { reloadAccount } = useAuth();
  const [name, setName] = useState(initialName);
  const [jobTitle, setJobTitle] = useState(initialJobTitle);
  const save = useMutation({
    mutationFn: async () => {
      if (name.trim() !== initialName) {
        await api("/auth/me", { method: "PATCH", body: { name: name.trim() } });
      }
      if (showJobTitle && jobTitle.trim() !== initialJobTitle) {
        await api(`/w/${workspaceSlug}/profile`, {
          method: "PATCH",
          body: { jobTitle: jobTitle.trim() === "" ? null : jobTitle.trim() },
        });
      }
      await reloadAccount();
    },
    onSuccess: () => {
      toast.success(t.saved);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const dirty =
    name.trim() !== initialName || (showJobTitle && jobTitle.trim() !== initialJobTitle);
  return (
    <Section title={t.title} description={t.description}>
      <FormField label={t.name} hint={t.nameHint}>
        {(control) => (
          <Input
            {...control}
            value={name}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </FormField>
      {showJobTitle && (
        <FormField label={t.jobTitle} hint={t.jobTitleHint}>
          {(control) => (
            <Input
              {...control}
              value={jobTitle}
              maxLength={80}
              placeholder={t.jobTitlePlaceholder}
              onChange={(event) => {
                setJobTitle(event.target.value);
              }}
            />
          )}
        </FormField>
      )}
      <div>
        <Button
          disabled={save.isPending || !dirty || name.trim().length < 2}
          onClick={() => {
            save.mutate();
          }}
        >
          {save.isPending ? texts.admin.common.saving : texts.admin.common.save}
        </Button>
      </div>
    </Section>
  );
}

// ─── Email ───────────────────────────────────────────────────────────────────────────────

function EmailSection({
  email,
  pending,
  verified,
}: {
  email: string;
  pending: string | null;
  verified: boolean;
}) {
  const t = texts.profile.email;
  const { reloadAccount } = useAuth();
  const [next, setNext] = useState("");
  const [password, setPassword] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const request = useMutation({
    mutationFn: () =>
      api("/auth/change-email", {
        method: "POST",
        body: { email: next.trim(), currentPassword: password },
      }),
    onSuccess: async () => {
      toast.success(t.sent(next.trim()));
      setNext("");
      setPassword("");
      await reloadAccount();
    },
    onError: (error) => {
      // Con 2FA, cambiar el email pide confirmar el código: se pide y se reintenta.
      if (error instanceof ApiError && error.code === "MFA_RECENT_REQUIRED") {
        setNeedsCode(true);
        return;
      }
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Section title={t.title} description={t.description}>
      {needsCode && (
        <ConfirmCodeDialog
          onClose={() => {
            setNeedsCode(false);
          }}
          onConfirmed={() => {
            setNeedsCode(false);
            request.mutate();
          }}
        />
      )}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{email}</span>
        <Badge tone={verified ? "success" : "warning"}>
          {verified ? t.verified : t.unverified}
        </Badge>
      </p>
      {pending !== null && (
        <p
          role="status"
          className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground"
        >
          {t.pending(pending)}
        </p>
      )}
      <FormField label={t.new}>
        {(control) => (
          <Input
            {...control}
            type="email"
            value={next}
            maxLength={254}
            autoComplete="email"
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label={t.currentPassword} hint={t.currentPasswordHint}>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        )}
      </FormField>
      <div>
        <Button
          disabled={request.isPending || next.trim() === "" || password === ""}
          onClick={() => {
            request.mutate();
          }}
        >
          {request.isPending ? t.sending : t.submit}
        </Button>
      </div>
    </Section>
  );
}

// ─── Contraseña ──────────────────────────────────────────────────────────────────────────

function PasswordSection() {
  const t = texts.profile.password;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const change = useMutation({
    mutationFn: () =>
      api("/auth/change-password", {
        method: "POST",
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      toast.success(t.done);
      setCurrent("");
      setNext("");
      setRepeat("");
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const mismatch = repeat !== "" && repeat !== next;
  return (
    <Section title={t.title} description={t.description}>
      <FormField label={t.current}>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label={t.new} hint={t.newHint}>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={next}
            autoComplete="new-password"
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label={t.repeat} {...(mismatch ? { error: t.mismatch } : {})}>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={repeat}
            autoComplete="new-password"
            onChange={(event) => {
              setRepeat(event.target.value);
            }}
          />
        )}
      </FormField>
      <div>
        <Button
          disabled={change.isPending || current === "" || next.length < 10 || next !== repeat}
          onClick={() => {
            change.mutate();
          }}
        >
          {change.isPending ? t.changing : t.submit}
        </Button>
      </div>
    </Section>
  );
}

// ─── Sesiones ────────────────────────────────────────────────────────────────────────────

function SessionsSection() {
  const t = texts.profile.sessions;
  const queryClient = useQueryClient();
  const key = ["profile", "sessions"] as const;
  const sessions = useQuery({
    queryKey: key,
    queryFn: () => api<{ sessions: SessionView[] }>("/auth/sessions"),
  });
  const close = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success(t.closed);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Section title={t.title} description={t.description}>
      {sessions.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : sessions.isError ? (
        <p className="text-xs text-muted-foreground">{loadErrorText(sessions.error)}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {sessions.data.sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {session.device}
                  {session.current && <Badge tone="primary">{t.current}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.details(
                    session.ip ?? t.unknownIp,
                    formatDateTime(session.signedInAt),
                    formatDateTime(session.lastUsedAt),
                  )}
                </p>
              </div>
              {!session.current && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={close.isPending}
                  onClick={() => {
                    close.mutate(session.id);
                  }}
                >
                  {t.close}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─── Tema ────────────────────────────────────────────────────────────────────────────────

const THEMES: { value: ThemePreference; icon: LucideIcon }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

function ThemeSection() {
  const t = texts.profile.theme;
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference);
  return (
    <Section title={t.title} description={t.description}>
      <div role="radiogroup" aria-label={t.title} className="flex flex-wrap gap-2">
        {THEMES.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={preference === value}
            onClick={() => {
              setThemePreference(value);
              setPreference(value);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-checked:border-primary/40 aria-checked:bg-primary-soft aria-checked:font-medium aria-checked:text-primary-soft-foreground"
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {texts.common.theme[value]}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** «El de la empresa» (sin idioma propio) o uno de los idiomas, cada uno con su propio nombre. */
const COMPANY_LOCALE = "company";

function LanguageSection({ companyName }: { companyName: string }) {
  const t = texts.profile.language;
  const { account } = useAuth();
  const source = useStaticSource("profile-language", [
    { id: COMPANY_LOCALE, label: t.company(companyName) },
    ...LOCALES.map((id) => ({ id, label: LOCALE_NAMES[id] })),
  ]);
  const save = useMutation({
    mutationFn: (locale: string | null) => api("/auth/me", { method: "PATCH", body: { locale } }),
    onSuccess: (_data, locale) => {
      toast.success(t.saved);
      // Sin idioma propio, el de la empresa lo fija la app al recargar.
      if (isLocale(locale)) switchLocale(locale);
      else window.location.reload();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (account === null) return null;
  return (
    <Section title={t.title} description={t.description}>
      <Combobox
        label={t.label}
        placeholder={t.label}
        searchable={false}
        disabled={save.isPending}
        source={source}
        value={account.user.locale ?? COMPANY_LOCALE}
        onChange={(option) => {
          if (option !== null) save.mutate(option.id === COMPANY_LOCALE ? null : option.id);
        }}
      />
    </Section>
  );
}
