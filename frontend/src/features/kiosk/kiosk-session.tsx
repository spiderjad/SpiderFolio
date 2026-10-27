// Sesión de tablet compartida (CLAUDE.md, sección 7.6): cierre por inactividad con aviso, cambio
// rápido de usuario y cierre después de confirmar una lectura. El servidor ya vence la sesión
// por inactividad (el refresh dura lo mismo); esto es la parte visible, y mientras haya actividad
// renueva la sesión para que servidor y pantalla coincidan.
import { UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import type { Account } from "@/auth/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { refreshAccessToken } from "@/lib/api";
import { texts } from "@/i18n";

/** Segundos de aviso antes de cerrar. */
const WARNING_SECONDS = 30;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

type Kiosk = NonNullable<Account["kiosk"]>;

/**
 * Cierra la sesión tras `idleSeconds` sin actividad (toque, tecla, rueda). Avisa en los últimos
 * segundos con una cuenta regresiva y la persona puede seguir con un toque.
 */
export function IdleGuard({ kiosk }: { kiosk: Kiosk }) {
  const t = texts.kiosk.idle;
  const { logout } = useAuth();
  const idleMs = kiosk.idleSeconds * 1000;
  // Con lapsos cortos el aviso no puede durar más de la mitad del lapso.
  const warnMs = Math.min(WARNING_SECONDS * 1000, idleMs / 2);
  const [remaining, setRemaining] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const lastRenewal = useRef(Date.now());

  const activity = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    setRemaining(null);
    // Si ya pasó la mitad del lapso desde que se renovó, se renueva la sesión del servidor.
    if (now - lastRenewal.current > idleMs / 2) {
      lastRenewal.current = now;
      void refreshAccessToken();
    }
  }, [idleMs]);

  useEffect(() => {
    lastActivity.current = Date.now();
    lastRenewal.current = Date.now();
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, activity, { passive: true });
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= idleMs) {
        clearInterval(timer);
        void logout();
      } else if (idle >= idleMs - warnMs) {
        setRemaining(Math.ceil((idleMs - idle) / 1000));
      }
    }, 1000);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, activity);
      clearInterval(timer);
    };
  }, [activity, idleMs, logout, warnMs]);

  return (
    <Dialog open={remaining !== null}>
      <DialogContent
        title={t.title}
        description={t.text}
        footer={
          <Button size="lg" onClick={activity}>
            {t.keep}
          </Button>
        }
      >
        <p
          role="timer"
          aria-live="polite"
          className="text-center text-5xl font-semibold tabular-nums"
        >
          {remaining ?? 0}
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">{t.countdown}</p>
      </DialogContent>
    </Dialog>
  );
}

/** Botón grande de la barra superior para pasar a otra persona sin escribir el usuario de nuevo. */
export function SwitchUserButton() {
  const { logout } = useAuth();
  return (
    <Button
      variant="outline"
      onClick={() => {
        void logout();
      }}
    >
      <UserRoundCog strokeWidth={1.75} aria-hidden="true" />
      {texts.kiosk.switchUser}
    </Button>
  );
}

/** Segundos que se muestra "Lectura confirmada" antes de cerrar la sesión. */
export const CONFIRMED_SECONDS = 3;

/**
 * Para la pantalla de confirmación de lectura (Módulo 6): al confirmar, en una tablet compartida
 * se avisa y se cierra la sesión para que la siguiente persona empiece de cero. Con otro tipo de
 * sesión no hace nada.
 */
export function useCloseAfterConfirm(): () => void {
  const { account, logout } = useAuth();
  const kiosk = account?.kiosk ?? null;
  return useCallback(() => {
    if (kiosk === null || !kiosk.closeAfterConfirm) return;
    toast.success(texts.kiosk.confirmed);
    setTimeout(() => {
      void logout();
    }, CONFIRMED_SECONDS * 1000);
  }, [kiosk, logout]);
}
