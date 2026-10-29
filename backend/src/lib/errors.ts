// Errores de la API con formato único (CLAUDE.md, sección 12):
// { "error": { "code", "message", "details"?, "requestId"? } }
import { errorMessages } from "../i18n/index.ts";

export const errorStatus = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  /** Login o contraseña actual incorrectos. La app solo refresca la sesión ante UNAUTHENTICATED. */
  INVALID_CREDENTIALS: 401,
  INVALID_TOKEN: 400,
  /** Código de la verificación en dos pasos incorrecto o ya usado. */
  MFA_INVALID_CODE: 400,
  FORBIDDEN: 403,
  LIMIT_REACHED: 403,
  /** La acción pide haber confirmado el código de 2FA hace menos de 10 minutos. */
  MFA_RECENT_REQUIRED: 403,
  /** El workspace exige verificación en dos pasos y la persona todavía no la configuró. */
  MFA_SETUP_REQUIRED: 403,
  /** The company only lets people in through its directory (owners keep their own password). */
  DIRECTORY_SIGN_IN_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const satisfies Record<keyof typeof errorMessages, number>;

export type ErrorCode = keyof typeof errorStatus;

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, options: { message?: string; details?: unknown } = {}) {
    super(options.message ?? errorMessages[code]);
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
  }

  get status(): number {
    return errorStatus[this.code];
  }
}

export const notFound = () => new AppError("NOT_FOUND");
export const forbidden = () => new AppError("FORBIDDEN");
export const unauthenticated = () => new AppError("UNAUTHENTICATED");
