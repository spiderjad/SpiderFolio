// Estado de la sesión (CLAUDE.md, sección 7.3).
// Arranque: /auth/refresh y luego /auth/me, con una pantalla de carga mientras tanto.
// Logout: la API revoca y borra la cookie; acá se borra el access token de memoria, se vacía
// el caché de TanStack Query, se vuelve a /login con replace y se avisa a las demás pestañas.
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { api, onSessionExpired, refreshAccessToken, SAME_ORIGIN_HEADERS } from "@/lib/api";
import {
  forgetKioskWorkspace,
  readKioskWorkspace,
  rememberKioskWorkspace,
  signedOutPath,
} from "@/lib/kiosk";
import { createAuthChannel } from "./broadcast";
import { getAccessToken, setAccessToken } from "./token-store";
import type { Account, AuthResponse } from "./types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  companyName: string;
  acceptTerms: true;
  marketingOptIn: boolean;
}

interface AuthContextValue {
  status: AuthStatus;
  /** true si la sesión terminó por un logout (acá o en otra pestaña): el login va sin next. */
  signedOut: boolean;
  account: Account | null;
  /**
   * Primer paso del login. Con la verificación en dos pasos activa no abre sesión: devuelve el
   * desafío para `verifyMfa` (el código de la app).
   */
  login: (email: string, password: string) => Promise<Account | { challenge: string }>;
  /** Segundo paso: el código de la app (o uno de recuperación) y si se recuerda este dispositivo. */
  verifyMfa: (challenge: string, code: string, remember: boolean) => Promise<Account>;
  /** Ingreso de lectores de planta con usuario + PIN (tablets compartidas). */
  pinLogin: (workspaceSlug: string, loginName: string, pin: string) => Promise<Account>;
  register: (input: RegisterInput) => Promise<Account>;
  /**
   * Acepta una invitación (módulo 2). Sin cuenta para ese email, `details` crea la cuenta y abre
   * la sesión; con cuenta, hay que haber iniciado sesión con ella. Devuelve el slug del workspace.
   */
  acceptInvitation: (
    token: string,
    details?: { name: string; password: string; acceptTerms: true; marketingOptIn: boolean },
  ) => Promise<{ workspaceSlug: string }>;
  /** Acepta la versión vigente de los términos (tras un cambio de versión). */
  acceptTerms: () => Promise<void>;
  logout: () => Promise<void>;
  /** Vuelve a pedir /auth/me (ej. después de verificar el email). */
  reloadAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const channelRef = useRef<ReturnType<typeof createAuthChannel> | null>(null);
  // Para saber, al cerrarse la sesión, si era de tablet (vuelve al teclado y no al login).
  const wasKiosk = useRef(false);
  wasKiosk.current = account?.kiosk != null;

  const signOutLocally = useCallback(() => {
    const kiosk = wasKiosk.current;
    setAccessToken(null);
    queryClient.clear();
    setAccount(null);
    setSignedOut(true);
    setStatus("anonymous");
    void navigate(signedOutPath(kiosk, readKioskWorkspace()), { replace: true });
  }, [navigate, queryClient]);

  const bootstrap = useCallback(async () => {
    if (getAccessToken() === null && !(await refreshAccessToken())) {
      setStatus("anonymous");
      return;
    }
    try {
      setAccount(await api<Account>("/auth/me"));
      setStatus("authenticated");
    } catch {
      setAccessToken(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void bootstrap();
    const channel = createAuthChannel((message) => {
      if (message.type === "logout") signOutLocally();
      else void bootstrap();
    });
    channelRef.current = channel;
    const stopExpired = onSessionExpired(signOutLocally);
    // Si el navegador restaura la página desde su caché sin sesión, recargar: así "atrás"
    // después del logout nunca muestra datos.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && getAccessToken() === null) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      channel.close();
      stopExpired();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [bootstrap, signOutLocally]);

  const startSession = useCallback((response: AuthResponse): Account => {
    setAccessToken(response.accessToken);
    const next: Account = {
      user: response.user,
      kiosk: response.kiosk,
      instance: response.instance,
      memberships: response.memberships,
    };
    setAccount(next);
    setSignedOut(false);
    setStatus("authenticated");
    channelRef.current?.post({ type: "login" });
    return next;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      signedOut,
      account,
      async login(email, password) {
        const response = await api<AuthResponse | { mfaRequired: true; challenge: string }>(
          "/auth/login",
          { method: "POST", body: { email, password } },
        );
        if ("mfaRequired" in response) return { challenge: response.challenge };
        // Una sesión común en este navegador: ya no es una tablet de planta.
        forgetKioskWorkspace();
        return startSession(response);
      },
      async verifyMfa(challenge, code, remember) {
        const response = await api<AuthResponse>("/auth/2fa/verify", {
          method: "POST",
          body: { challenge, code, remember },
        });
        forgetKioskWorkspace();
        return startSession(response);
      },
      async pinLogin(workspaceSlug, loginName, pin) {
        const response = await api<AuthResponse>("/auth/pin-login", {
          method: "POST",
          body: { workspaceSlug, loginName, pin },
        });
        // Solo se recuerda el workspace, nunca el usuario.
        rememberKioskWorkspace(workspaceSlug);
        return startSession(response);
      },
      async register(input) {
        const timezone = browserTimezone();
        const response = await api<AuthResponse>("/auth/register", {
          method: "POST",
          body: { ...input, ...(timezone === undefined ? {} : { timezone }) },
        });
        return startSession(response);
      },
      async acceptInvitation(token, details) {
        const response = await api<
          (AuthResponse & { workspaceSlug: string }) | { workspaceSlug: string }
        >(`/auth/invitations/${encodeURIComponent(token)}/accept`, {
          method: "POST",
          body: details ?? {},
        });
        if ("accessToken" in response) startSession(response);
        else setAccount(await api<Account>("/auth/me"));
        return { workspaceSlug: response.workspaceSlug };
      },
      async acceptTerms() {
        await api("/auth/accept-terms", { method: "POST", body: { acceptTerms: true } });
        setAccount(await api<Account>("/auth/me"));
      },
      async logout() {
        try {
          await api("/auth/logout", { method: "POST", headers: SAME_ORIGIN_HEADERS });
        } catch {
          // Aunque la API no responda, la sesión local se cierra igual.
        }
        channelRef.current?.post({ type: "logout" });
        signOutLocally();
      },
      async reloadAccount() {
        setAccount(await api<Account>("/auth/me"));
      },
    }),
    [account, signOutLocally, signedOut, startSession, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth fuera de AuthProvider");
  return context;
}
