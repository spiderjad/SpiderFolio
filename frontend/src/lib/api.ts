// Cliente HTTP de la API (/api/v1). Envía el access token en memoria y, ante un 401 con
// código UNAUTHENTICATED, refresca la sesión una sola vez y reintenta (CLAUDE.md, sección 7.3).
// Nunca refresca ante INVALID_CREDENTIALS (login o contraseña actual incorrectos).
import { getAccessToken, setAccessToken } from "@/auth/token-store";
import { locale } from "@/i18n";
import { noteRestart, RESTART_HEADER } from "./restart";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Errores de red (sin respuesta del servidor). */
export class NetworkError extends Error {
  constructor() {
    super("network");
    this.name = "NetworkError";
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "INTERNAL";
  const message = typeof body?.error?.message === "string" ? body.error.message : "";
  return new ApiError(res.status, code, message, body?.error?.details);
}

/** Cabeceras que exigen /refresh y /logout (CSRF, sección 7.2). */
export const SAME_ORIGIN_HEADERS = { "X-Requested-With": "spiderfolio" } as const;

// ─── Refresh compartido ──────────────────────────────────────────────────────

type SessionListener = () => void;
const expiredListeners = new Set<SessionListener>();

/** Se llama cuando la sesión ya no se puede renovar (la app vuelve al login). */
export function onSessionExpired(listener: SessionListener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const run = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: SAME_ORIGIN_HEADERS,
        credentials: "same-origin",
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return true;
    } catch {
      return false;
    }
  };
  // Entre pestañas: una sola rota el refresh token a la vez; la siguiente ya usa la cookie
  // nueva (sección 7.3). El margen de 5 s del backend cubre navegadores sin Web Locks.
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return await navigator.locks.request("spiderfolio-refresh", run);
  }
  return await run();
}

/** Renueva el access token. Llamadas simultáneas en la pestaña comparten una sola promesa. */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ─── Requests ────────────────────────────────────────────────────────────────

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** A file sent as is (application/octet-stream), instead of a JSON body. */
  file?: Blob;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  // Los mensajes de la API vuelven en el idioma activo de la app.
  const headers: Record<string, string> = { "Accept-Language": locale, ...options.headers };
  const token = getAccessToken();
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.file !== undefined) headers["Content-Type"] = "application/octet-stream";
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
      ...(options.file !== undefined
        ? { body: options.file }
        : options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new NetworkError();
  }
}

/** Endpoints que ya son el login o el refresh: un 401 ahí no se intenta renovar. */
const NO_REFRESH_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
]);

/** Request con renovación de sesión; devuelve la respuesta cruda (ok o no). */
async function request(path: string, options: RequestOptions): Promise<Response> {
  let res = await send(path, options);

  if (res.status === 401 && !NO_REFRESH_PATHS.has(path)) {
    const error = await toApiError(res.clone());
    if (error.code === "UNAUTHENTICATED") {
      if (await refreshAccessToken()) {
        res = await send(path, options);
      } else {
        setAccessToken(null);
        for (const listener of expiredListeners) listener();
      }
    }
  }
  noteRestart(res.headers.get(RESTART_HEADER));
  return res;
}

/** Request a la API. Devuelve el JSON (o undefined en 204) o lanza ApiError/NetworkError. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await request(path, options);
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Como `api`, pero devuelve el cuerpo como archivo (descargas de PDF). */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const res = await request(path, options);
  if (!res.ok) throw await toApiError(res);
  return await res.blob();
}

/** Como `api`, pero devuelve el cuerpo como texto (descargas de CSV). */
export async function apiText(path: string, options: RequestOptions = {}): Promise<string> {
  const res = await request(path, options);
  if (!res.ok) throw await toApiError(res);
  return await res.text();
}

/** Como `api`, pero devuelve la respuesta cruda (para leer un stream); lanza ApiError si no es ok. */
export async function apiStream(path: string, options: RequestOptions = {}): Promise<Response> {
  const res = await request(path, options);
  if (!res.ok) throw await toApiError(res);
  return res;
}
