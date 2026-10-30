// Forma de /auth/me, /auth/login y /auth/register (backend/src/modules/auth/auth.service.ts).
import type { Locale } from "@/i18n";

export type SystemRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

export interface Membership {
  id: string;
  seatType: "FULL" | "READER";
  jobTitle: string | null;
  workspace: {
    id: string;
    name: string;
    slug: string;
    accentColor: string | null;
    logoKey: string | null;
    /** Idioma por defecto de la empresa. */
    locale: Locale;
    /** The company's time zone (IANA): every date and time in the app is shown in it. */
    timeZone: string;
  };
  role: { id: string; name: string; base: SystemRole };
  capabilities: string[];
  departments: { id: string; name: string; position: "HEAD" | "DEPUTY" | "MEMBER" }[];
  /** Jefe o subjefe: ve Miembros y Departamentos de su área (el servidor acota el alcance). */
  leadsDepartments: boolean;
  /** La política del workspace le exige verificación en dos pasos. */
  mfaRequired: boolean;
}

export interface Account {
  user: {
    id: string;
    /** "PIN": lector de planta que entra con usuario y PIN, sin email. */
    kind: "STANDARD" | "PIN";
    email: string | null;
    name: string;
    emailVerified: boolean;
    /** Email nuevo pedido, a la espera de su confirmación. */
    pendingEmail: string | null;
    /** Idioma elegido en Mi perfil; null = el de la empresa. */
    locale: Locale | null;
    avatarKey: string | null;
    /** Direcciones de la foto de perfil y la portada (null sin imagen); encuadre de la portada, 0–100. */
    avatarUrl: string | null;
    coverUrl: string | null;
    coverPositionY: number;
    /** Términos y Privacidad: `required` pide aceptar la versión vigente antes de seguir. */
    terms: { currentVersion: string; acceptedVersion: string | null; required: boolean };
    marketingOptIn: boolean;
    /** Equipo de SpiderFolio: ve el backoffice /internal. */
    isStaff: boolean;
    /** Tiene activa la verificación en dos pasos. */
    twoFactor: boolean;
  };
  /** Sesión de tablet (solo quien entra con PIN): cierre por inactividad y tras confirmar. */
  kiosk: { idleSeconds: number; closeAfterConfirm: boolean } | null;
  /** Lo que ofrece esta instalación (para avisar lo que no está). */
  instance: { controlledPdf: boolean };
  memberships: Membership[];
}

export interface AuthResponse extends Account {
  accessToken: string;
  expiresIn: number;
}
