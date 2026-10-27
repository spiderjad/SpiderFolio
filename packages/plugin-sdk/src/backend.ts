// Puntos de extensión del backend (docs/spec/plugins.md). El plugin exporta por defecto un
// BackendPlugin; el núcleo lo carga al arrancar y solo lo activa en los workspaces cuya licencia lo
// incluye. Un plugin nunca recibe el cliente de Prisma: trabaja con su contexto (ajustes propios,
// SQL en su esquema, auditoría) y con los ganchos que el núcleo consulta.
import type { Request, Response } from "express";
import type { z } from "zod";
import type { PluginCapabilityId, PluginId } from "./index.ts";

export * from "./index.ts";

export interface PluginLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

/** Ajustes del plugin en un workspace (clave → JSON), guardados por el núcleo. */
export interface PluginSettings {
  get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * SQL parametrizado ($1, $2…) en el esquema propio del plugin (plugin_<id>), creado por sus
 * migraciones. El aislamiento entre empresas es responsabilidad del plugin: toda tabla lleva
 * workspace_id y toda consulta filtra por `ctx.workspaceId`.
 */
export interface PluginSql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<T[]>;
}

/** Lo que el plugin puede usar dentro de un workspace donde está activo. */
export interface PluginWorkspaceContext {
  readonly pluginId: PluginId;
  readonly workspaceId: string;
  settings: PluginSettings;
  sql: PluginSql;
  logger: PluginLogger;
  /** Encola un job propio (declarado en `jobs`) con este workspace. */
  enqueue(job: string, payload: Record<string, unknown>): Promise<void>;
}

export type RoleBase = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

export interface AuditInput {
  /** Se guarda como «plugin.<id>.<action>». */
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/** Contexto de un pedido de una persona del workspace (ya autenticada y con la licencia vigente). */
export interface PluginRequestContext extends PluginWorkspaceContext {
  readonly userId: string;
  readonly membershipId: string;
  readonly roleBase: RoleBase;
  readonly capabilities: readonly string[];
  audit(entry: AuditInput): Promise<void>;
  /** Falla con MFA_RECENT_REQUIRED si la persona no confirmó su código de 2FA hace poco. */
  requireRecentMfa(): Promise<void>;
  /** Si la persona tiene la verificación en dos pasos activa. */
  hasOwnMfa(): Promise<boolean>;
}

export interface PluginRoute {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** Relativa a /api/v1/w/:workspaceSlug/plugins/<id>. */
  path: `/${string}`;
  /** Exige todas estas capacidades (del núcleo o del plugin). */
  capability?: string | readonly string[];
  /** Exige al menos una. */
  anyCapability?: readonly string[];
  ownerOnly?: boolean;
  handler(req: Request, res: Response, ctx: PluginRequestContext): Promise<void> | void;
}

/** Contexto de un job del worker. */
export interface PluginJobContext {
  logger: PluginLogger;
  /** Contexto de un workspace; null si el plugin no está activo ahí. */
  forWorkspace(workspaceId: string): Promise<PluginWorkspaceContext | null>;
  /** Workspaces donde el plugin está activo (licencia vigente). */
  activeWorkspaces(): Promise<string[]>;
}

export interface PluginJob<T = unknown> {
  /** Cola «plugin.<id>.<name>». */
  name: string;
  schema: z.ZodType<T>;
  options?: { retryLimit?: number; retryDelay?: number; expireInSeconds?: number };
  /** Programación (cron, zona Europe/Madrid). Los jobs programados reciben `{}`. */
  cron?: string;
  handler(ctx: PluginJobContext, payload: T): Promise<void>;
}

export interface PluginCapability {
  id: PluginCapabilityId;
  label: string;
  description: string;
}

export interface MfaSubject {
  userKind: "STANDARD" | "PIN";
  roleBase: RoleBase;
  capabilities: readonly string[];
}

/** Ganchos que el núcleo consulta. Solo se llaman en workspaces donde el plugin está activo. */
export interface CoreHooks {
  /** Si el workspace le exige a esta persona la verificación en dos pasos. */
  mfaRequired?(ctx: PluginWorkspaceContext, subject: MfaSubject): Promise<boolean>;
  /**
   * Antes de invitar o importar a alguien: un mensaje si el email no se admite, o null. No se llama
   * para invitados externos.
   */
  checkMemberEmail?(ctx: PluginWorkspaceContext, email: string): Promise<string | null>;
}

export interface BackendPlugin {
  id: PluginId;
  version: string;
  routes?: readonly PluginRoute[];
  jobs?: readonly PluginJob[];
  capabilities?: readonly PluginCapability[];
  /** Funciones que el plugin agrega (el núcleo pregunta por ellas con hasFeature). */
  features?: readonly string[];
  /**
   * Textos del backend del plugin (avisos, errores, etiquetas), un catálogo por idioma. Se leen con
   * `localized(catalogs)` en el momento de usarlos (ver `pluginLocale`).
   */
  i18n?: Readonly<Record<PluginLocale, Readonly<Record<string, unknown>>>>;
  hooks?: CoreHooks;
}

/** Idiomas de la app (docs/spec/i18n.md). */
export type PluginLocale = "es" | "en";

// El núcleo registra cómo leer el idioma activo (el de la petición o del job). Va en globalThis con
// una clave compartida para que funcione aunque el plugin traiga su propia copia del SDK.
const LOCALE_RESOLVER = Symbol.for("spiderfolio.plugin-sdk.locale");

/** Solo el núcleo: cómo leer el idioma activo. */
export function providePluginLocale(resolve: () => PluginLocale): void {
  Reflect.set(globalThis, LOCALE_RESOLVER, resolve);
}

/** Idioma activo: el de la petición (lo que pide la app) o el del job; `es` si no hay. */
export function pluginLocale(): PluginLocale {
  const resolve: unknown = Reflect.get(globalThis, LOCALE_RESOLVER);
  const locale = typeof resolve === "function" ? (resolve as () => unknown)() : undefined;
  return locale === "en" ? "en" : "es";
}

/** El catálogo del idioma activo. Llamarlo al usar el texto, no al cargar el módulo. */
export function localized<T>(catalogs: Readonly<Record<PluginLocale, T>>): T {
  return catalogs[pluginLocale()];
}

export function defineBackendPlugin<const T extends BackendPlugin>(plugin: T): T {
  return plugin;
}

export function definePluginJob<T>(job: PluginJob<T>): PluginJob<T> {
  return job;
}

/** Errores que un plugin puede devolver; el núcleo los traduce al formato único. */
export type PluginErrorCode = "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";

export class PluginError extends Error {
  readonly code: PluginErrorCode;
  constructor(code: PluginErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PluginError";
    this.code = code;
  }
}
