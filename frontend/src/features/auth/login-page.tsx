// /login and /login/:workspaceSlug: email and password, and the company's directory when a plugin
// offers one (docs/spec/plugins.md «Directorio de la empresa»).
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, PasswordInput } from "@/components/ui/form";
import { api, API_BASE, ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import { safeNext } from "@/lib/utils";
import { applyApiError } from "./form-errors";
import { LoginSchema, type LoginValues } from "./schemas";
import { takeChallengeFromHash } from "./token-from-hash";
import { texts } from "@/i18n";

/** What the company's sign-in screen offers (the plugins' directories), from the API. */
interface SignInOptions {
  workspaceSlug: string | null;
  providers: { pluginId: string; id: string; kind: "password" | "redirect"; label: string }[];
  directoryOnly: boolean;
}

type DirectoryProvider = SignInOptions["providers"][number];

const FAILURES = ["expired", "notAllowed", "emailTaken", "unavailable", "failed"] as const;

export function LoginPage() {
  const t = texts.auth.login;
  const { login } = useAuth();
  const { workspaceSlug } = useParams();
  // Back from the identity provider with 2FA on: the code step comes first.
  const [challenge, setChallenge] = useState<string | null>(() => takeChallengeFromHash());
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const options = useQuery({
    queryKey: ["auth", "sso-options", workspaceSlug ?? null],
    queryFn: () =>
      api<SignInOptions>(
        workspaceSlug === undefined
          ? "/auth/sso/options"
          : `/auth/sso/options?workspace=${encodeURIComponent(workspaceSlug)}`,
      ),
    staleTime: 60_000,
    retry: false,
  });
  const slug = options.data?.workspaceSlug ?? null;
  const providers = slug === null ? [] : (options.data?.providers ?? []);
  const failure = FAILURES.find((code) => code === params.get("signin"));
  const done = () => {
    const fallback = slug === null ? "/app" : `/app/${slug}`;
    void navigate(safeNext(params.get("next"), fallback), { replace: true, viewTransition: true });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await login(values.email, values.password);
      if ("challenge" in result) {
        setChallenge(result.challenge);
        return;
      }
      done();
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, ["email", "password"], {
          INVALID_CREDENTIALS: t.invalid,
        }),
      );
    }
  });

  if (challenge !== null) {
    return (
      <MfaStep
        challenge={challenge}
        onDone={done}
        onBack={() => {
          setChallenge(null);
          form.setValue("password", "");
        }}
      />
    );
  }

  // «Directory only»: owners still sign in with their email; the form is one click away.
  const emailHidden = options.data?.directoryOnly === true && providers.length > 0 && !showEmail;

  return (
    <AuthLayout
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <>
          {t.noAccount}{" "}
          <Link to="/register" viewTransition className="font-medium text-primary hover:underline">
            {t.register}
          </Link>
        </>
      }
    >
      <div className="grid gap-5">
        {failure !== undefined && (
          <FormAlert tone="danger">{t.directory.failure[failure]}</FormAlert>
        )}
        {slug !== null &&
          providers.map((provider) =>
            provider.kind === "redirect" ? (
              <Button
                key={`${provider.pluginId}/${provider.id}`}
                asChild
                size="lg"
                variant="outline"
              >
                <a href={startUrl(slug, provider, params.get("next"))}>
                  {t.directory.with(provider.label)}
                </a>
              </Button>
            ) : (
              <DirectoryPasswordForm
                key={`${provider.pluginId}/${provider.id}`}
                workspaceSlug={slug}
                provider={provider}
                onChallenge={setChallenge}
                onDone={done}
              />
            ),
          )}
        {providers.length > 0 && (
          <p className="text-center text-sm text-muted-foreground">{t.directory.or}</p>
        )}
        {emailHidden ? (
          <Button
            variant="ghost"
            onClick={() => {
              setShowEmail(true);
            }}
          >
            {t.directory.ownersOnly}
          </Button>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
            {formError !== null && <FormAlert tone="danger">{formError}</FormAlert>}
            <FormField label={texts.common.email} error={errors.email?.message}>
              {(field) => (
                <Input type="email" autoComplete="email" {...field} {...form.register("email")} />
              )}
            </FormField>
            <FormField label={texts.common.password} error={errors.password?.message}>
              {(field) => (
                <PasswordInput
                  autoComplete="current-password"
                  {...field}
                  {...form.register("password")}
                />
              )}
            </FormField>
            <Link
              to="/forgot-password"
              className="-mt-2 justify-self-end text-sm text-primary hover:underline"
            >
              {t.forgot}
            </Link>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {t.submit}
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}

/** Where a redirect provider starts (the API sends the browser on to the identity provider). */
function startUrl(slug: string, provider: DirectoryProvider, next: string | null): string {
  const path = [slug, provider.pluginId, provider.id].map(encodeURIComponent).join("/");
  const target = safeNext(next, "");
  const query = target.startsWith("/app") ? `?next=${encodeURIComponent(target)}` : "";
  return `${API_BASE}/auth/sso/${path}/start${query}`;
}

/** Username and password of the company's directory (the core checks them through the plugin). */
function DirectoryPasswordForm({
  workspaceSlug,
  provider,
  onChallenge,
  onDone,
}: {
  workspaceSlug: string;
  provider: DirectoryProvider;
  onChallenge: (challenge: string) => void;
  onDone: () => void;
}) {
  const t = texts.auth.login.directory;
  const { directoryLogin } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await directoryLogin(
        { workspaceSlug, pluginId: provider.pluginId, id: provider.id },
        username.trim(),
        password,
      );
      if ("challenge" in result) onChallenge(result.challenge);
      else onDone();
    } catch (failure) {
      setPassword("");
      setError(
        failure instanceof ApiError && failure.code === "INVALID_CREDENTIALS"
          ? t.invalid
          : errorText(failure),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
      <h2 className="text-sm font-semibold">{t.with(provider.label)}</h2>
      {error !== null && <FormAlert tone="danger">{error}</FormAlert>}
      <FormField label={t.username}>
        {(field) => (
          <Input
            {...field}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={256}
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label={texts.common.password}>
        {(field) => (
          <PasswordInput
            {...field}
            autoComplete="current-password"
            maxLength={256}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        )}
      </FormField>
      <Button
        type="submit"
        size="lg"
        disabled={pending || username.trim() === "" || password === ""}
      >
        {t.with(provider.label)}
      </Button>
    </form>
  );
}

/** Segundo paso: el código de la app o uno de recuperación, y «Recordar este dispositivo». */
function MfaStep({
  challenge,
  onDone,
  onBack,
}: {
  challenge: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const t = texts.auth.login.mfa;
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await verifyMfa(challenge, code.trim(), remember);
      onDone();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "INVALID_TOKEN") {
        // El desafío venció: se vuelve a la contraseña.
        onBack();
        return;
      }
      setError(
        failure instanceof ApiError && failure.code === "MFA_INVALID_CODE"
          ? t.invalid
          : errorText(failure),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthLayout title={t.title} subtitle={t.subtitle}>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
        {error !== null && <FormAlert tone="danger">{error}</FormAlert>}
        <FormField label={t.code} hint={t.recoveryHint}>
          {(field) => (
            <Input
              {...field}
              autoFocus
              autoComplete="one-time-code"
              maxLength={20}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={t.remember}
          checked={remember}
          onChange={(event) => {
            setRemember(event.target.checked);
          }}
        />
        <Button type="submit" size="lg" disabled={pending || code.trim().length < 6}>
          {t.submit}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t.back}
        </Button>
      </form>
    </AuthLayout>
  );
}
