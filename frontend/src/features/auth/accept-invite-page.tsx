// /accept-invite#token=… — aceptar una invitación (CLAUDE.md, secciones 7.3 y 9.3). El token viaja
// en el fragmento del enlace (no queda en logs). Sin cuenta para ese email, se crea con nombre y
// contraseña; con cuenta, hay que iniciar sesión con ella y abrir de nuevo el enlace del email:
// el token nunca se pasa por query para no dejarlo en logs de servidor.
import { zodResolver } from "@hookform/resolvers/zod";
import { MailWarning, UserCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input, PasswordInput } from "@/components/ui/form";
import { api } from "@/lib/api";
import { applyApiError } from "./form-errors";
import { TermsFields } from "./terms-fields";
import { AcceptInviteSchema, type AcceptInviteValues } from "./schemas";
import { takeTokenFromHash } from "./token-from-hash";
import { texts } from "@/i18n";

interface Preview {
  email: string;
  workspaceName: string;
  roleName: string;
  inviterName: string | null;
  hasAccount: boolean;
}

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "ready"; token: string; preview: Preview };

export function AcceptInvitePage() {
  const t = texts.admin.acceptInvite;
  const { status, account, acceptInvitation, logout } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [formError, setFormError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  // El token se lee una vez (StrictMode ejecuta el efecto dos veces).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeTokenFromHash();
    if (token === null) {
      setState({ kind: "missing" });
      return;
    }
    api<Preview>(`/auth/invitations/${encodeURIComponent(token)}`)
      .then((preview) => {
        setState({ kind: "ready", token, preview });
      })
      .catch(() => {
        setState({ kind: "invalid" });
      });
  }, []);

  const form = useForm<AcceptInviteValues>({
    resolver: zodResolver(AcceptInviteSchema),
    defaultValues: { name: "", password: "", acceptTerms: false, marketingOptIn: false },
  });
  const { errors, isSubmitting } = form.formState;

  const goTo = (slug: string) => {
    void navigate(`/app/${slug}`, { replace: true });
  };

  const createAccount = form.handleSubmit(async (values) => {
    if (state.kind !== "ready") return;
    setFormError(null);
    try {
      const { workspaceSlug } = await acceptInvitation(state.token, {
        ...values,
        acceptTerms: true,
      });
      goTo(workspaceSlug);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ["name", "password"]));
    }
  });

  const acceptWithAccount = async () => {
    if (state.kind !== "ready") return;
    setFormError(null);
    setAccepting(true);
    try {
      const { workspaceSlug } = await acceptInvitation(state.token);
      goTo(workspaceSlug);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, []));
      setAccepting(false);
    }
  };

  const title = state.kind === "ready" ? t.subtitle(state.preview.workspaceName) : t.title;
  return (
    <AuthLayout title={title}>
      {(state.kind === "loading" || (state.kind === "ready" && status === "loading")) && (
        <div className="grid gap-3" aria-busy="true">
          <p className="text-muted-foreground">{t.verifying}</p>
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {(state.kind === "invalid" || state.kind === "missing") && (
        <p className="flex items-start gap-2 text-sm" role="alert">
          <MailWarning
            className="mt-0.5 size-5 shrink-0 text-warning"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {state.kind === "invalid" ? t.invalid : t.missing}
        </p>
      )}

      {state.kind === "ready" && status !== "loading" && (
        <FormGrid>
          <p className="text-muted-foreground">
            {t.details(state.preview.inviterName, state.preview.roleName)}
          </p>
          {formError !== null && <FormAlert tone="danger">{formError}</FormAlert>}

          {status === "authenticated" && account !== null ? (
            account.user.email === state.preview.email ? (
              <div className="grid gap-4">
                <p className="flex items-center gap-2 text-sm">
                  <UserCheck
                    className="size-5 text-success"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  {t.signedInAs(account.user.email)}
                </p>
                <Button size="lg" disabled={accepting} onClick={() => void acceptWithAccount()}>
                  {accepting ? t.accepting : t.accept}
                </Button>
              </div>
            ) : (
              <div className="grid gap-4">
                <FormAlert tone="danger">{t.wrongAccount(state.preview.email)}</FormAlert>
                <Button variant="outline" size="lg" onClick={() => void logout()}>
                  {texts.common.logout}
                </Button>
              </div>
            )
          ) : state.preview.hasAccount ? (
            <div className="grid gap-4">
              <p className="text-sm">{t.haveAccount}</p>
              <Button asChild size="lg">
                <Link to="/login">{t.login}</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={(e) => void createAccount(e)} noValidate className="grid gap-5">
              <p className="text-xs text-muted-foreground">{t.createAccount}</p>
              <FormField label={texts.common.email}>
                {(field) => <Input {...field} value={state.preview.email} readOnly disabled />}
              </FormField>
              <FormField label={t.name} error={errors.name?.message}>
                {(field) => <Input autoComplete="name" {...field} {...form.register("name")} />}
              </FormField>
              <FormField label={t.password} hint={t.passwordHint} error={errors.password?.message}>
                {(field) => (
                  <PasswordInput
                    autoComplete="new-password"
                    {...field}
                    {...form.register("password")}
                  />
                )}
              </FormField>
              <TermsFields
                accept={form.register("acceptTerms")}
                marketing={form.register("marketingOptIn")}
                error={errors.acceptTerms?.message}
              />
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting ? t.submitting : t.submit}
              </Button>
            </form>
          )}
        </FormGrid>
      )}
    </AuthLayout>
  );
}
