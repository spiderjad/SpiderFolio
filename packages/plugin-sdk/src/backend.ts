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

/**
 * Secrets of the plugin in a workspace (a service account password, a client secret). The core keeps
 * them encrypted with its own key, bound to the company, the plugin and the key; they never reach the
 * app or the logs. `set` fails if the server has no encryption key configured.
 */
export interface PluginSecrets {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Whether it is saved, without reading it (to show «saved» in a form). */
  has(key: string): Promise<boolean>;
}

/**
 * A person as the company's directory describes them. The core links them by `externalId` (the
 * directory's stable id: objectGUID, oid), never by email.
 */
export interface DirectoryMember {
  externalId: string;
  /** Address managed by the directory: the account is created with it already confirmed. */
  email: string;
  name: string;
  /** Role to give; never the owner role. Missing: the current one (Member for someone new). */
  roleId?: string;
  /** Exactly these departments (they keep their position in the ones they stay in). Missing: unchanged. */
  departmentIds?: readonly string[];
  jobTitle?: string | null;
}

/** What a redirect provider returns: the person, and whether the identity provider did MFA. */
export interface RedirectSignIn extends DirectoryMember {
  /**
   * The ID token says a second factor was used (Entra ID: `amr` includes "mfa"). If the company trusts
   * it (`trustProviderMfa`, on by default), SpiderFolio doesn't ask for its own code at sign-in.
   */
  mfa?: boolean;
}

export type DirectorySyncResult =
  | {
      status: "created" | "updated" | "unchanged" | "reactivated";
      membershipId: string;
      /** What the core didn't apply and why (an owner's role, an email another account uses…). */
      skipped: readonly ("ownerRole" | "sharedIdentity" | "emailTaken")[];
    }
  /** Someone else already has this email: an administrator links them by hand (`link`). */
  | { status: "conflict"; reason: "emailTaken" };

export interface LinkedMember {
  membershipId: string;
  externalId: string;
  status: "ACTIVE" | "SUSPENDED";
  /** Owners are never suspended nor have their role changed by the directory. */
  owner: boolean;
  suspendedByDirectory: boolean;
}

/**
 * The company's members as a directory sees them (docs/spec/plugins.md «Directorio de la empresa»).
 * The core applies every change within the company and audits it; `provider` is one of the plugin's
 * `authProviders`.
 */
export interface PluginDirectory {
  roles(): Promise<{ id: string; name: string; base: RoleBase }[]>;
  departments(): Promise<{ id: string; name: string; parentId: string | null }[]>;
  /**
   * Creates or updates the member linked to this account. Someone suspended by the directory is
   * reactivated; someone an administrator suspended stays suspended.
   */
  syncMember(provider: string, member: DirectoryMember): Promise<DirectorySyncResult>;
  /** Suspends the member linked to this account (never an owner). */
  suspendMember(
    provider: string,
    externalId: string,
  ): Promise<"suspended" | "unchanged" | "owner" | "notLinked">;
  /** Members linked through this provider, a page at a time (`cursor` from the previous page). */
  linkedMembers(
    provider: string,
    cursor?: string,
  ): Promise<{ items: LinkedMember[]; nextCursor: string | null }>;
  /** Links an existing member to a directory account (an administrator's decision, from a route). */
  link(provider: string, membershipId: string, externalId: string): Promise<void>;
  unlink(membershipId: string): Promise<void>;
  /** Active owners who can sign in with their own password and two-step verification. */
  localOwnersWithMfa(): Promise<number>;
  /**
   * «Directory only»: whoever isn't an owner only gets into the company signing in with this plugin's
   * directory. Turning it on needs at least one owner with password and two-step verification
   * (CONFLICT otherwise). It only applies while the plugin is active.
   */
  setDirectoryOnly(on: boolean): Promise<void>;
  directoryOnly(): Promise<boolean>;
  /**
   * Whether a redirect provider's MFA (RedirectSignIn.mfa) replaces SpiderFolio's own code at sign-in.
   * On by default; password providers always ask for the person's own code.
   */
  setTrustProviderMfa(on: boolean): Promise<void>;
  trustProviderMfa(): Promise<boolean>;
}

/** Lo que el plugin puede usar dentro de un workspace donde está activo. */
export interface PluginWorkspaceContext {
  readonly pluginId: PluginId;
  readonly workspaceId: string;
  settings: PluginSettings;
  secrets: PluginSecrets;
  directory: PluginDirectory;
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

/** How a provider shows on the company's sign-in screen; null: not configured there. */
export interface AuthProviderInfo {
  label: string;
}

interface AuthProviderBase {
  /** Id inside the plugin (lowercase, digits and dashes). */
  id: string;
  describe(ctx: PluginWorkspaceContext): Promise<AuthProviderInfo | null>;
}

/**
 * Username and password checked against the directory (LDAP). The core does the rest: attempt limits,
 * lockout, a constant response time, the session, two-step verification and the audit. The password is
 * only passed to `verify`; never store it.
 */
export interface PasswordAuthProvider extends AuthProviderBase {
  kind: "password";
  /** The person to sign in, or null if the credentials are wrong or they aren't allowed in. */
  verify(
    ctx: PluginWorkspaceContext,
    credentials: { username: string; password: string },
  ): Promise<DirectoryMember | null>;
}

/**
 * Sign-in at the identity provider (OIDC). The core generates and keeps the state, the PKCE verifier
 * and the nonce (bound to the company and to the browser, for a few minutes) and checks the state when
 * the browser comes back.
 */
export interface RedirectAuthProvider extends AuthProviderBase {
  kind: "redirect";
  /** Where to send the browser (S256 code challenge). */
  authorizationUrl(
    ctx: PluginWorkspaceContext,
    request: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
  ): Promise<string>;
  /**
   * Back from the provider: exchange the code with `codeVerifier`, validate the ID token (issuer,
   * audience, nonce, the company's tenant) and return the person, or null if they aren't allowed in.
   * Set `mfa` only from the validated token.
   */
  callback(
    ctx: PluginWorkspaceContext,
    response: {
      redirectUri: string;
      callbackUrl: URL;
      state: string;
      nonce: string;
      codeVerifier: string;
    },
  ): Promise<RedirectSignIn | null>;
}

export type AuthProvider = PasswordAuthProvider | RedirectAuthProvider;

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
  /** Ways to sign in to a company (pluginApi 2). Only offered where the plugin is active. */
  authProviders?: readonly AuthProvider[];
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
