// /app/:workspaceSlug — marco del workspace: aplica su color de acento (y lo vuelve a aplicar
// al cambiar el tema) y muestra el AppShell. Un slug al que no se tiene acceso es "no
// encontrado", igual que en la API. Cerrar sesión pide confirmación.
import { Building2, LogOut } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import type { Membership } from "@/auth/types";
import { AppShell } from "@/components/app-shell";
import { sectionTitle } from "@/components/nav-items";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, IconTile } from "@/components/ui/display";
import { UploadsProvider } from "@/features/files/uploads";
import { IdleGuard, SwitchUserButton } from "@/features/kiosk/kiosk-session";
import { applyAccent, clearAccent } from "@/lib/accent";
import { isDarkTheme, onThemeChange } from "@/lib/theme";
import { NotFoundPage } from "./not-found-page";
import { MandatoryTwoFactor } from "@/features/profile/mandatory-two-factor";
import { DIRECTORY_SIGN_IN_EVENT, MFA_SETUP_EVENT } from "@/lib/query-client";
import { PluginDialogHost } from "@/plugins/plugin-actions";
import { useActivePlugins } from "@/plugins/registry";
import { switchLocale, texts } from "@/i18n";

/** Membresía del workspace actual, para las pantallas dentro de WorkspaceLayout. */
const MembershipContext = createContext<Membership | null>(null);

/**
 * Membresía del workspace actual. Va por un contexto de React y no por el de <Outlet>: las rutas
 * anidadas sin elemento (como /admin) no lo propagan.
 */
export function useMembership(): Membership {
  const membership = useContext(MembershipContext);
  if (membership === null) throw new Error("useMembership fuera de WorkspaceLayout");
  return membership;
}

export function WorkspaceLayout() {
  const { workspaceSlug } = useParams();
  const { pathname } = useLocation();
  const { account, logout, reloadAccount } = useAuth();
  const membership = account?.memberships.find((m) => m.workspace.slug === workspaceSlug);
  const plugins = useActivePlugins(workspaceSlug ?? "");
  const accentColor = membership?.workspace.accentColor ?? null;
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [directoryRequired, setDirectoryRequired] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const apply = () => {
      applyAccent(accentColor, isDarkTheme());
    };
    apply();
    const stop = onThemeChange(apply);
    return () => {
      stop();
      clearAccent();
    };
  }, [accentColor]);

  // Idioma: el de la persona o, si no eligió, el de esta empresa (si cambia, la app recarga).
  const wantedLocale =
    membership === undefined ? null : (account?.user.locale ?? membership.workspace.locale);
  useEffect(() => {
    if (wantedLocale !== null) switchLocale(wantedLocale);
  }, [wantedLocale]);

  // La política de 2FA cambió con la sesión abierta: se vuelve a pedir la cuenta y aparece la activación.
  useEffect(() => {
    const onRequired = () => {
      void reloadAccount();
    };
    window.addEventListener(MFA_SETUP_EVENT, onRequired);
    return () => {
      window.removeEventListener(MFA_SETUP_EVENT, onRequired);
    };
  }, [reloadAccount]);

  // The company only lets this person in through its directory (and this session didn't use it).
  useEffect(() => {
    const onRequired = () => {
      setDirectoryRequired(true);
    };
    window.addEventListener(DIRECTORY_SIGN_IN_EVENT, onRequired);
    return () => {
      window.removeEventListener(DIRECTORY_SIGN_IN_EVENT, onRequired);
    };
  }, []);

  if (account === null) return <Navigate to="/login" replace />;
  if (membership === undefined) return <NotFoundPage />;

  return (
    <AppShell
      account={account}
      membership={membership}
      title={sectionTitle(pathname, plugins)}
      {...(account.kiosk === null ? {} : { actions: <SwitchUserButton /> })}
      onLogout={() => {
        setConfirmingLogout(true);
      }}
    >
      <MembershipContext.Provider value={membership}>
        {directoryRequired ? (
          <DirectorySignInRequired
            workspaceName={membership.workspace.name}
            onSignOut={() => {
              const slug = membership.workspace.slug;
              void logout().then(() => {
                void navigate(`/login/${encodeURIComponent(slug)}`, { replace: true });
              });
            }}
          />
        ) : membership.mfaRequired &&
          !account.user.twoFactor &&
          account.user.kind === "STANDARD" ? (
          <MandatoryTwoFactor
            workspaceName={membership.workspace.name}
            onLogout={() => {
              setConfirmingLogout(true);
            }}
          />
        ) : (
          <>
            {/* La cola de subidas vive acá: sigue subiendo aunque se cambie de pantalla. */}
            <UploadsProvider key={membership.workspace.slug}>
              <Outlet />
              <PluginDialogHost />
            </UploadsProvider>
          </>
        )}
      </MembershipContext.Provider>
      {account.kiosk !== null && <IdleGuard kiosk={account.kiosk} />}
      <ConfirmDialog
        open={confirmingLogout}
        onOpenChange={setConfirmingLogout}
        icon={LogOut}
        tone="primary"
        title={texts.shell.logoutDialog.title}
        description={texts.shell.logoutDialog.text}
        confirmLabel={texts.common.logout}
        pendingLabel={texts.shell.logoutDialog.pending}
        onConfirm={logout}
      />
    </AppShell>
  );
}

/** /app — al primer workspace de la persona, o un estado vacío si no tiene ninguno. */
export function AppIndex() {
  const { account } = useAuth();
  const first = account?.memberships[0];
  if (first !== undefined) return <Navigate to={`/app/${first.workspace.slug}`} replace />;
  return (
    <NotFoundPage title={texts.shell.noWorkspaces.title} text={texts.shell.noWorkspaces.text} />
  );
}

/** The company signs people in with their work account: this session has to sign in again with it. */
function DirectorySignInRequired({
  workspaceName,
  onSignOut,
}: {
  workspaceName: string;
  onSignOut: () => void;
}) {
  const t = texts.auth.login.directoryRequired;
  return (
    <div className="mx-auto grid w-full max-w-lg py-10">
      <Card className="grid justify-items-center gap-4 p-6 text-center sm:p-8">
        <IconTile icon={Building2} size="lg" />
        <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.text(workspaceName)}</p>
        <Button onClick={onSignOut}>{t.action}</Button>
      </Card>
    </div>
  );
}
