import { Navigate, Outlet, useLocation, useSearchParams } from "react-router";
import { Logo } from "@/components/ui/display";
import { readKioskWorkspace } from "@/lib/kiosk";
import { safeNext } from "@/lib/utils";
import { TermsGatePage } from "@/features/auth/terms-gate-page";
import { useAuth } from "./auth-context";
import { texts } from "@/i18n";

/** Pantalla mientras se recupera la sesión: el logo, nunca un spinner de pantalla completa. */
export function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background" aria-busy="true">
      <div className="flex flex-col items-center gap-3 animate-pulse">
        <Logo />
        <span className="sr-only">{texts.app.loading}</span>
      </div>
    </div>
  );
}

/** Rutas privadas: sin sesión, al login (recordando a dónde se quería ir). */
export function RequireAuth() {
  const { status, signedOut, account } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "anonymous") {
    // Una tablet de planta (última sesión con PIN) vuelve al teclado de su workspace.
    const kioskSlug = readKioskWorkspace();
    if (kioskSlug !== null && location.pathname.startsWith(`/app/${kioskSlug}`)) {
      return <Navigate to={`/entrar/${encodeURIComponent(kioskSlug)}`} replace />;
    }
    // Después de un logout, el login no recuerda la página anterior.
    if (signedOut) return <Navigate to="/login" replace />;
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  // Cambió la versión de los términos: hay que aceptarla antes de seguir.
  if (account?.user.terms.required === true) return <TermsGatePage />;
  return <Outlet />;
}

/** Login y registro: con sesión, directo a la app. */
export function GuestOnly() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  if (status === "loading") return <Splash />;
  if (status === "authenticated") return <Navigate to={safeNext(params.get("next"))} replace />;
  return <Outlet />;
}
