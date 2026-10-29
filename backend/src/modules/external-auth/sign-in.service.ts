// Signing in with a company's directory (docs/spec/plugins.md «Directorio de la empresa»): the
// providers a plugin declares (authProviders) only check who someone is. The core keeps everything
// else: attempt limits (rate limits on the routes), a minimum response time, the OIDC state, PKCE
// verifier and nonce, the link to the member, two-step verification, the session and the audit.
import type {
  AuthProvider,
  DirectoryMember,
  PasswordAuthProvider,
  PluginDirectory,
  PluginWorkspaceContext,
  RedirectAuthProvider,
  RedirectSignIn,
} from "@spiderfolio/plugin-sdk/backend";
import { directorySignInLimits } from "@spiderfolio/limits";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { forTenant } from "../../db/tenant.ts";
import { directorySignInTexts } from "../../i18n/index.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { AppError } from "../../lib/errors.ts";
import type { AppDeps } from "../../routes.ts";
import type { InstalledPlugin } from "../../plugins/loader.ts";
import type { SignInProvider } from "../../plugins/runtime.ts";
import { auditGlobal } from "../audit/audit.service.ts";
import { createAuthService, type LoginResult } from "../auth/auth.service.ts";
import type { RequestInfo } from "../auth/sessions.service.ts";
import { readDirectoryOnly } from "../workspaces/settings.ts";

/** Why a sign-in didn't work, as the app shows it (`?signin=` on the sign-in screen). */
export type SignInFailure = "expired" | "notAllowed" | "emailTaken" | "unavailable" | "failed";

export class SignInError extends AppError {
  readonly failure: SignInFailure;
  constructor(failure: SignInFailure) {
    const messages = {
      expired: directorySignInTexts.flowExpired,
      notAllowed: directorySignInTexts.notAllowed,
      emailTaken: directorySignInTexts.emailTaken,
      unavailable: directorySignInTexts.unavailable,
      failed: directorySignInTexts.invalidCredentials,
    } as const;
    const code =
      failure === "failed"
        ? "INVALID_CREDENTIALS"
        : failure === "emailTaken"
          ? "CONFLICT"
          : failure === "unavailable"
            ? "NOT_FOUND"
            : "FORBIDDEN";
    super(code, { message: messages[failure] });
    this.failure = failure;
  }
}

export interface ProviderView {
  pluginId: string;
  id: string;
  kind: AuthProvider["kind"];
  label: string;
}

export interface SignInOptions {
  /** The company the screen is for: the one asked for or, on a server with one, that one. */
  workspaceSlug: string | null;
  providers: ProviderView[];
  /** Only owners sign in with email and password (the rest use the directory). */
  directoryOnly: boolean;
}

interface Resolved<P extends AuthProvider> {
  workspace: { id: string; slug: string };
  /** The sign-in address and where the accounts are linked (SignInProvider.pluginId). */
  pluginId: string;
  provider: P;
  /** The context of the plugin the provider belongs to. */
  ctx: PluginWorkspaceContext;
  /** The directory the accounts are linked in: the plugin's own, or the one it shares. */
  directory: PluginDirectory;
}

const MINUTE_MS = 60_000;

/** The browser's PKCE challenge for a verifier (S256). */
const codeChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/** Only paths inside the app (never another site) to go back to after signing in. */
export function safeNextPath(next: unknown): string | null {
  return typeof next === "string" && /^\/app(\/[^\s\\]*)?$/u.test(next) && !next.startsWith("//")
    ? next.slice(0, 500)
    : null;
}

export function createDirectorySignIn(deps: AppDeps) {
  const { prisma, plugins, logger, env } = deps;
  const auth = createAuthService(deps);

  async function workspaceFor(slug: string | undefined) {
    if (slug !== undefined) {
      return await prisma.workspace.findFirst({
        where: { slug, deletedAt: null },
        select: { id: true, slug: true, settings: true },
      });
    }
    const only = await prisma.workspace.findMany({
      where: { deletedAt: null },
      select: { id: true, slug: true, settings: true },
      take: 2,
    });
    return only.length === 1 ? (only[0] ?? null) : null;
  }

  /** A provider's label in the company, or null if it isn't configured (or fails). */
  async function describe(
    plugin: InstalledPlugin,
    provider: AuthProvider,
    ctx: PluginWorkspaceContext,
  ): Promise<string | null> {
    try {
      return (await provider.describe(ctx))?.label ?? null;
    } catch (error) {
      logger.error(
        { err: error, plugin: plugin.manifest.id, provider: provider.id },
        "Proveedor de inicio de sesión fallido",
      );
      return null;
    }
  }

  async function resolve<K extends AuthProvider["kind"]>(
    slug: string,
    pluginId: string,
    providerId: string,
    kind: K,
  ): Promise<Resolved<Extract<AuthProvider, { kind: K }>>> {
    const workspace = await workspaceFor(slug);
    if (workspace === null) throw new SignInError("unavailable");
    const entry = (await plugins.signInProviders(workspace.id)).find(
      (candidate) => candidate.pluginId === pluginId && candidate.provider.id === providerId,
    );
    const provider = entry?.provider;
    if (entry === undefined || provider?.kind !== kind) throw new SignInError("unavailable");
    const { ctx, directory } = contextsOf(workspace.id, entry);
    if ((await describe(entry.plugin, provider, ctx)) === null) {
      throw new SignInError("unavailable");
    }
    return {
      workspace,
      pluginId,
      provider: provider as Extract<AuthProvider, { kind: K }>,
      ctx,
      directory,
    };
  }

  /** The provider's plugin context, and the directory its accounts are linked in. */
  function contextsOf(workspaceId: string, entry: SignInProvider) {
    const ctx = plugins.contextFor(workspaceId, entry.plugin.manifest.id);
    const directory =
      entry.pluginId === entry.plugin.manifest.id
        ? ctx.directory
        : ctx.shared(entry.pluginId).directory;
    return { ctx, directory };
  }

  const fail = async (
    resolved: { workspace: { id: string }; pluginId: string; provider: { id: string } },
    reason: string,
    info: RequestInfo,
    actorId: string | null = null,
  ) => {
    await auditGlobal(prisma, {
      workspaceId: resolved.workspace.id,
      actorId,
      action: "auth.login.failure",
      metadata: { reason, provider: `${resolved.pluginId}/${resolved.provider.id}` },
      ...info,
    });
  };

  /** Links (or creates) the member and continues like a password sign-in: 2FA, then the session. */
  async function signIn(
    resolved: Resolved<AuthProvider>,
    member: DirectoryMember,
    info: RequestInfo,
    trustedDeviceToken: string | undefined,
    /** Only a redirect provider's word, and only if the company trusts it; never a password one. */
    providerMfa = false,
  ): Promise<LoginResult> {
    const result = await resolved.directory.syncMember(resolved.provider.id, member);
    if (result.status === "conflict") {
      await fail(resolved, "email_taken", info);
      throw new SignInError("emailTaken");
    }
    const db = forTenant(prisma, resolved.workspace.id);
    const membership = await db.membership.findFirst({
      where: { id: result.membershipId },
      select: { userId: true, status: true },
    });
    if (membership === null) throw new SignInError("failed");
    if (membership.status !== "ACTIVE") {
      await fail(resolved, "suspended", info, membership.userId);
      throw new SignInError("failed");
    }
    await db.externalIdentity.updateMany({
      where: { membershipId: result.membershipId },
      data: { lastLoginAt: new Date() },
    });
    return await auth.completeDirectorySignIn(
      membership.userId,
      {
        workspaceId: resolved.workspace.id,
        provider: `${resolved.pluginId}/${resolved.provider.id}`,
      },
      info,
      trustedDeviceToken,
      providerMfa &&
        resolved.provider.kind === "redirect" &&
        (await resolved.directory.trustProviderMfa()),
    );
  }

  return {
    /** What the company's sign-in screen offers. Never fails: without providers, the usual form. */
    async options(slug: string | undefined): Promise<SignInOptions> {
      const none: SignInOptions = { workspaceSlug: null, providers: [], directoryOnly: false };
      const workspace = await workspaceFor(slug);
      if (workspace === null) return none;
      const providers: ProviderView[] = [];
      for (const entry of await plugins.signInProviders(workspace.id)) {
        const { ctx } = contextsOf(workspace.id, entry);
        const label = await describe(entry.plugin, entry.provider, ctx);
        if (label !== null) {
          providers.push({
            pluginId: entry.pluginId,
            id: entry.provider.id,
            kind: entry.provider.kind,
            label,
          });
        }
      }
      if (providers.length === 0) return { ...none, workspaceSlug: workspace.slug };
      const holder = readDirectoryOnly(workspace.settings);
      return {
        workspaceSlug: workspace.slug,
        providers,
        directoryOnly: holder !== null && providers.some((p) => p.pluginId === holder),
      };
    },

    /** Username and password against the directory, answering in a minimum time either way. */
    async passwordSignIn(
      route: { slug: string; pluginId: string; providerId: string },
      credentials: { username: string; password: string },
      info: RequestInfo,
      trustedDeviceToken: string | undefined,
    ): Promise<LoginResult> {
      const started = Date.now();
      try {
        const resolved: Resolved<PasswordAuthProvider> = await resolve(
          route.slug,
          route.pluginId,
          route.providerId,
          "password",
        );
        let member: DirectoryMember | null = null;
        try {
          member = await resolved.provider.verify(resolved.ctx, credentials);
        } catch (error) {
          logger.error(
            { err: error, plugin: resolved.pluginId, provider: resolved.provider.id },
            "Proveedor de inicio de sesión fallido",
          );
        }
        if (member === null) {
          await fail(resolved, "wrong_credentials", info);
          throw new SignInError("failed");
        }
        return await signIn(resolved, member, info, trustedDeviceToken);
      } finally {
        const left = directorySignInLimits.minResponseMs - (Date.now() - started);
        if (left > 0) await sleep(left);
      }
    },

    /** Leaving for the identity provider: the flow is kept bound to this browser (`browser`). */
    async redirectStart(
      route: { slug: string; pluginId: string; providerId: string },
      next: string | null,
    ): Promise<{ url: string; browser: string }> {
      const resolved: Resolved<RedirectAuthProvider> = await resolve(
        route.slug,
        route.pluginId,
        route.providerId,
        "redirect",
      );
      const state = randomToken();
      const nonce = randomToken();
      const codeVerifier = randomToken(48);
      const browser = randomToken();
      const url = await resolved.provider.authorizationUrl(resolved.ctx, {
        redirectUri: callbackUri(env.APP_URL, route),
        state,
        nonce,
        codeChallenge: codeChallenge(codeVerifier),
      });
      const target = new URL(url);
      if (
        target.protocol !== "https:" &&
        !(env.NODE_ENV !== "production" && target.protocol === "http:")
      ) {
        throw new SignInError("unavailable");
      }
      await forTenant(prisma, resolved.workspace.id).ssoFlow.create({
        data: {
          pluginId: resolved.pluginId,
          provider: resolved.provider.id,
          stateHash: sha256(state),
          browserHash: sha256(browser),
          codeVerifier,
          nonce,
          next,
          expiresAt: new Date(Date.now() + directorySignInLimits.flowMinutes * MINUTE_MS),
        },
      });
      return { url: target.toString(), browser };
    },

    /** Back from the identity provider: the flow is used once, from the browser that started it. */
    async redirectCallback(
      route: { slug: string; pluginId: string; providerId: string },
      callbackUrl: URL,
      browser: string | undefined,
      info: RequestInfo,
      trustedDeviceToken: string | undefined,
    ): Promise<{ result: LoginResult; next: string | null }> {
      const resolved: Resolved<RedirectAuthProvider> = await resolve(
        route.slug,
        route.pluginId,
        route.providerId,
        "redirect",
      );
      const state = callbackUrl.searchParams.get("state");
      if (state === null || browser === undefined) throw new SignInError("expired");
      const db = forTenant(prisma, resolved.workspace.id);
      const now = new Date();
      const flow = await db.ssoFlow.findFirst({
        where: {
          stateHash: sha256(state),
          pluginId: resolved.pluginId,
          provider: resolved.provider.id,
        },
        select: { id: true, browserHash: true, codeVerifier: true, nonce: true, next: true },
      });
      const claimed =
        flow === null || flow.browserHash !== sha256(browser)
          ? 0
          : (
              await db.ssoFlow.updateMany({
                where: { id: flow.id, usedAt: null, expiresAt: { gt: now } },
                data: { usedAt: now },
              })
            ).count;
      if (flow === null || claimed === 0) {
        await fail(resolved, "flow_expired", info);
        throw new SignInError("expired");
      }
      if (callbackUrl.searchParams.has("error")) {
        await fail(resolved, "provider_error", info);
        throw new SignInError("notAllowed");
      }
      let member: RedirectSignIn | null = null;
      try {
        member = await resolved.provider.callback(resolved.ctx, {
          redirectUri: callbackUri(env.APP_URL, route),
          callbackUrl,
          state,
          nonce: flow.nonce,
          codeVerifier: flow.codeVerifier,
        });
      } catch (error) {
        logger.error(
          { err: error, plugin: resolved.pluginId, provider: resolved.provider.id },
          "Proveedor de inicio de sesión fallido",
        );
      }
      if (member === null) {
        await fail(resolved, "not_allowed", info);
        throw new SignInError("notAllowed");
      }
      return {
        result: await signIn(resolved, member, info, trustedDeviceToken, member.mfa === true),
        next: flow.next,
      };
    },
  };
}

/** Where the identity provider sends the browser back (registered in the provider's app). */
export function callbackUri(
  appUrl: string,
  route: { slug: string; pluginId: string; providerId: string },
): string {
  const base = appUrl.replace(/\/+$/u, "");
  return `${base}/api/v1/auth/sso/${encodeURIComponent(route.slug)}/${route.pluginId}/${route.providerId}/callback`;
}

export type DirectorySignIn = ReturnType<typeof createDirectorySignIn>;
