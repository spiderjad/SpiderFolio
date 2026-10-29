// The connector's OAuth 2.1 flow (docs/spec/conector-mcp.md): the authorization request is checked and
// handed to the app's consent screen signed (no table); the person picks the company and approves; a
// one-use code (PKCE S256, 2 minutes) becomes an access token (1 hour) and a refresh token that rotates
// on every use. Presenting a refresh token that was already rotated revokes the whole connection. Only
// SHA-256 hashes are stored. Every connection is one person in one company, with their permissions.
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import type { AppDeps } from "../../routes.ts";
import { auditGlobal } from "../audit/audit.service.ts";
import {
  ACCESS_TOKEN_SECONDS,
  canonicalResource,
  CODE_SECONDS,
  oauthUrls,
  REFRESH_TOKEN_DAYS,
  REQUEST_MINUTES,
  SCOPES,
  type Scope,
} from "./oauth.config.ts";
import {
  fetchMetadataDocument,
  OAuthClientError,
  onlyLoopback,
  redirectUriAllowed,
  registerClient,
  resolveClient,
  type MetadataFetcher,
} from "./oauth.clients.ts";

/** An OAuth error as RFC 6749 names it, with the HTTP status to answer it with. */
export class OAuthError extends Error {
  readonly error: string;
  readonly status: number;
  constructor(error: string, description: string, status = 400) {
    super(description);
    this.name = "OAuthError";
    this.error = error;
    this.status = status;
  }
}

/** The request is broken in a way that can't be sent back to the client (bad client or redirect). */
export class OAuthPageError extends Error {
  readonly reason: "invalid_client" | "invalid_redirect_uri" | "invalid_request" | "expired";
  constructor(reason: OAuthPageError["reason"]) {
    super(reason);
    this.name = "OAuthPageError";
    this.reason = reason;
  }
}

const RequestSchema = z.object({
  /** OAuthClient.id */
  c: z.string(),
  r: z.string(),
  cc: z.string(),
  s: z.array(z.string()),
  st: z.string().nullable(),
  exp: z.number(),
});
type SignedRequest = z.infer<typeof RequestSchema>;

const AuthorizeQuerySchema = z.object({
  response_type: z.string().optional(),
  client_id: z.string().min(1).max(500),
  redirect_uri: z.string().min(1).max(500),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  scope: z.string().max(200).optional(),
  state: z.string().max(500).optional(),
  resource: z.string().max(500).optional(),
});

/** Who a valid access token acts for. */
export interface McpPrincipal {
  grantId: string;
  userId: string;
  workspaceId: string;
  scopes: readonly Scope[];
  clientName: string;
}

export interface OAuthOptions {
  fetcher?: MetadataFetcher;
  now?: () => Date;
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

const scopesOf = (value: string | undefined): Scope[] => {
  const wanted = new Set((value ?? "").split(/\s+/u).filter((scope) => scope !== ""));
  const known: Scope[] = [SCOPES.read, SCOPES.write];
  const asked = known.filter((scope) => wanted.has(scope));
  // Without a scope (or only unknown ones) the client asks for reading, never more.
  return asked.length === 0 ? [SCOPES.read] : asked;
};

export function createOAuthService(deps: AppDeps, options: OAuthOptions = {}) {
  const { prisma, plugins, env } = deps;
  const urls = oauthUrls(env);
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetcher ?? fetchMetadataDocument;
  const key = createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update("spiderfolio-oauth-request-v1")
    .digest();
  const mac = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

  const signRequest = (request: SignedRequest) => {
    const payload = Buffer.from(JSON.stringify(request)).toString("base64url");
    return `${payload}.${mac(payload)}`;
  };
  const readRequest = (raw: string): SignedRequest => {
    const [payload, signature] = raw.split(".");
    if (payload === undefined || signature === undefined)
      throw new OAuthPageError("invalid_request");
    const expected = Buffer.from(mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new OAuthPageError("invalid_request");
    }
    const parsed = RequestSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown,
    );
    if (!parsed.success) throw new OAuthPageError("invalid_request");
    if (parsed.data.exp * 1000 <= now().getTime()) throw new OAuthPageError("expired");
    return parsed.data;
  };

  /** The client's redirect with the result (RFC 9207: always with iss). */
  const redirectWith = (redirectUri: string, params: Record<string, string | null>) => {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(params)) {
      if (value !== null) url.searchParams.set(name, value);
    }
    url.searchParams.set("iss", urls.issuer);
    return url.toString();
  };

  /** The connector is on in the company: a plugin gives it and the owner didn't turn it off. */
  async function connectorOn(workspaceId: string, settings: unknown): Promise<boolean> {
    const disabled =
      (settings as { mcpDisabled?: unknown } | null | undefined)?.mcpDisabled === true;
    return !disabled && (await plugins.hasFeature(workspaceId, "mcp_read"));
  }

  /** The person's companies where they may connect, and whether they may let Claude write there. */
  async function eligibleCompanies(userId: string) {
    const memberships = await prisma.membership.findMany({
      where: {
        userId,
        status: "ACTIVE",
        workspace: { deletedAt: null },
        role: { base: { not: "GUEST" } },
      },
      select: {
        seatType: true,
        workspace: { select: { id: true, slug: true, name: true, settings: true } },
      },
      orderBy: { workspace: { name: "asc" } },
    });
    const companies = [];
    for (const membership of memberships) {
      const { workspace } = membership;
      if (!(await connectorOn(workspace.id, workspace.settings))) continue;
      companies.push({
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        canWrite:
          membership.seatType === "FULL" && (await plugins.hasFeature(workspace.id, "mcp_write")),
      });
    }
    return companies;
  }

  async function issueTokens(grantId: string, familyId: string, scopes: readonly string[]) {
    const access = randomToken(32);
    const refresh = randomToken(32);
    const at = now().getTime();
    await prisma.oAuthToken.createMany({
      data: [
        {
          grantId,
          type: "ACCESS",
          tokenHash: sha256(access),
          familyId,
          expiresAt: new Date(at + ACCESS_TOKEN_SECONDS * 1000),
        },
        {
          grantId,
          type: "REFRESH",
          tokenHash: sha256(refresh),
          familyId,
          expiresAt: new Date(at + REFRESH_TOKEN_DAYS * 24 * 3600_000),
        },
      ],
    });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: refresh,
      scope: scopes.join(" "),
    };
  }

  /** Revokes a connection and every token it has (the person, an admin, or a reused refresh token). */
  async function revokeGrant(grantId: string) {
    const at = now();
    await prisma.$transaction([
      prisma.oAuthGrant.updateMany({
        where: { id: grantId, revokedAt: null },
        data: { revokedAt: at },
      }),
      prisma.oAuthToken.updateMany({
        where: { grantId, revokedAt: null },
        data: { revokedAt: at },
      }),
    ]);
  }

  return {
    urls,
    revokeGrant,

    /** POST /oauth/register (RFC 7591). */
    register: (body: unknown) => registerClient(prisma, body),

    /**
     * GET /oauth/authorize: where to send the browser. A bad client or redirect URI never goes back to
     * the client (OAuthPageError); anything else wrong goes back with the error.
     */
    async authorize(query: Record<string, unknown>): Promise<string> {
      const parsed = AuthorizeQuerySchema.safeParse(query);
      if (!parsed.success) throw new OAuthPageError("invalid_request");
      const q = parsed.data;
      let client;
      try {
        client = await resolveClient(prisma, q.client_id, fetcher, now());
      } catch (error) {
        if (error instanceof OAuthClientError) throw new OAuthPageError("invalid_client");
        throw error;
      }
      if (!redirectUriAllowed(client.redirectUris, q.redirect_uri)) {
        throw new OAuthPageError("invalid_redirect_uri");
      }
      const back = (error: string, description: string) =>
        redirectWith(q.redirect_uri, {
          error,
          error_description: description,
          state: q.state ?? null,
        });
      if (q.response_type !== "code") return back("unsupported_response_type", "Only code");
      if (q.code_challenge === undefined || q.code_challenge_method !== "S256") {
        return back("invalid_request", "PKCE with S256 is required");
      }
      if (!/^[A-Za-z0-9_-]{43,128}$/u.test(q.code_challenge)) {
        return back("invalid_request", "Invalid code_challenge");
      }
      if (q.resource !== undefined && canonicalResource(q.resource) !== urls.resource) {
        return back("invalid_target", `The resource is ${urls.resource}`);
      }
      const request = signRequest({
        c: client.id,
        r: q.redirect_uri,
        cc: q.code_challenge,
        s: scopesOf(q.scope),
        st: q.state ?? null,
        exp: Math.floor(now().getTime() / 1000) + REQUEST_MINUTES * 60,
      });
      return `${urls.consent}#request=${encodeURIComponent(request)}`;
    },

    /** What the consent screen shows: the application, where it sends you back, and your companies. */
    async consentOverview(userId: string, rawRequest: string) {
      const request = readRequest(rawRequest);
      const client = await prisma.oAuthClient.findUnique({ where: { id: request.c } });
      if (client === null) throw new OAuthPageError("invalid_client");
      return {
        client: {
          name: client.clientName,
          redirectHost: new URL(request.r).host,
          loopbackOnly: onlyLoopback(client.redirectUris),
          verified: client.kind === "METADATA_DOCUMENT",
        },
        wantsWrite: request.s.includes(SCOPES.write),
        companies: await eligibleCompanies(userId),
      };
    },

    /** The person's answer: back to the client with a code (or access_denied). */
    async decide(
      userId: string,
      rawRequest: string,
      decision: { allow: boolean; workspaceSlug?: string | undefined },
      info: { ip: string | null; userAgent: string | null },
    ): Promise<string> {
      const request = readRequest(rawRequest);
      const client = await prisma.oAuthClient.findUnique({ where: { id: request.c } });
      if (client === null) throw new OAuthPageError("invalid_client");
      if (!decision.allow) {
        return redirectWith(request.r, { error: "access_denied", state: request.st });
      }
      const company = (await eligibleCompanies(userId)).find(
        (candidate) => candidate.slug === decision.workspaceSlug,
      );
      if (company === undefined) throw new OAuthPageError("invalid_request");
      const scopes: Scope[] = [
        SCOPES.read,
        ...(request.s.includes(SCOPES.write) && company.canWrite ? [SCOPES.write] : []),
      ];
      // One connection per person, company and application: a new approval replaces the old one.
      const previous = await prisma.oAuthGrant.findMany({
        where: { userId, workspaceId: company.id, clientId: client.id, revokedAt: null },
        select: { id: true },
      });
      for (const grant of previous) await revokeGrant(grant.id);
      const grant = await prisma.oAuthGrant.create({
        data: { clientId: client.id, userId, workspaceId: company.id, scopes },
      });
      const code = randomToken(32);
      await prisma.oAuthToken.create({
        data: {
          grantId: grant.id,
          type: "CODE",
          tokenHash: sha256(code),
          codeChallenge: request.cc,
          redirectUri: request.r,
          expiresAt: new Date(now().getTime() + CODE_SECONDS * 1000),
        },
      });
      await auditGlobal(prisma, {
        workspaceId: company.id,
        actorId: userId,
        action: "connector.connect",
        entityType: "OAuthGrant",
        entityId: grant.id,
        metadata: { client: client.clientName, scopes },
        ...info,
      });
      return redirectWith(request.r, { code, state: request.st });
    },

    /** POST /oauth/token: authorization_code (with PKCE) or refresh_token (rotating). */
    async token(body: Record<string, unknown>) {
      const field = (name: string) => {
        const value = body[name];
        return typeof value === "string" && value !== "" ? value : undefined;
      };
      const clientId = field("client_id");
      if (clientId === undefined)
        throw new OAuthError("invalid_client", "client_id is required", 401);
      const resource = field("resource");
      if (resource !== undefined && canonicalResource(resource) !== urls.resource) {
        throw new OAuthError("invalid_target", `The resource is ${urls.resource}`);
      }
      const at = now();

      if (field("grant_type") === "authorization_code") {
        const code = field("code");
        const verifier = field("code_verifier");
        if (code === undefined || verifier === undefined) {
          throw new OAuthError("invalid_request", "code and code_verifier are required");
        }
        const stored = await prisma.oAuthToken.findUnique({
          where: { tokenHash: sha256(code) },
          include: { grant: { include: { client: true } } },
        });
        if (stored?.type !== "CODE" || stored.grant.client.clientId !== clientId) {
          throw new OAuthError("invalid_grant", "Unknown code");
        }
        // Used once only: a second try means it was stolen, so the connection goes too.
        const used = await prisma.oAuthToken.updateMany({
          where: { id: stored.id, usedAt: null },
          data: { usedAt: at },
        });
        if (used.count === 0) {
          await revokeGrant(stored.grantId);
          throw new OAuthError("invalid_grant", "Code already used");
        }
        if (
          stored.expiresAt <= at ||
          stored.grant.revokedAt !== null ||
          stored.redirectUri !== field("redirect_uri") ||
          stored.codeChallenge === null ||
          s256(verifier) !== stored.codeChallenge
        ) {
          throw new OAuthError("invalid_grant", "Invalid code");
        }
        return await issueTokens(stored.grantId, randomUUID(), stored.grant.scopes);
      }

      if (field("grant_type") === "refresh_token") {
        const refresh = field("refresh_token");
        if (refresh === undefined)
          throw new OAuthError("invalid_request", "refresh_token is required");
        const stored = await prisma.oAuthToken.findUnique({
          where: { tokenHash: sha256(refresh) },
          include: { grant: { include: { client: true } } },
        });
        if (stored?.type !== "REFRESH" || stored.grant.client.clientId !== clientId) {
          throw new OAuthError("invalid_grant", "Unknown refresh token");
        }
        // Rotated already (usedAt): someone kept a copy. The connection is revoked.
        const rotated = await prisma.oAuthToken.updateMany({
          where: { id: stored.id, usedAt: null, revokedAt: null },
          data: { usedAt: at, revokedAt: at },
        });
        if (rotated.count === 0) {
          if (stored.usedAt !== null) await revokeGrant(stored.grantId);
          throw new OAuthError("invalid_grant", "Refresh token no longer valid");
        }
        if (stored.expiresAt <= at || stored.grant.revokedAt !== null) {
          throw new OAuthError("invalid_grant", "Refresh token no longer valid");
        }
        return await issueTokens(
          stored.grantId,
          stored.familyId ?? randomUUID(),
          stored.grant.scopes,
        );
      }

      throw new OAuthError("unsupported_grant_type", "authorization_code or refresh_token");
    },

    /** POST /oauth/revoke (RFC 7009): a refresh token revokes the connection; always 200. */
    async revoke(body: Record<string, unknown>) {
      const token = typeof body.token === "string" ? body.token : "";
      if (token === "") return;
      const stored = await prisma.oAuthToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (stored === null) return;
      if (stored.type === "REFRESH") await revokeGrant(stored.grantId);
      else
        await prisma.oAuthToken.updateMany({
          where: { id: stored.id },
          data: { revokedAt: now() },
        });
    },

    /**
     * Who a bearer token acts for at /mcp, or why not: 401 (no valid token: sign in again) or 403
     * (the connector is off in the company, or the person can no longer use it).
     */
    async authenticate(
      authorization: string | undefined,
    ): Promise<McpPrincipal | { status: 401 | 403; description: string }> {
      const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/u.exec(authorization ?? "");
      if (match?.[1] === undefined) return { status: 401, description: "Missing bearer token" };
      const stored = await prisma.oAuthToken.findUnique({
        where: { tokenHash: sha256(match[1]) },
        include: {
          grant: {
            include: {
              client: { select: { clientName: true } },
              workspace: { select: { deletedAt: true, settings: true } },
            },
          },
        },
      });
      const at = now();
      if (
        stored?.type !== "ACCESS" ||
        stored.revokedAt !== null ||
        stored.expiresAt <= at ||
        stored.grant.revokedAt !== null ||
        stored.grant.workspace.deletedAt !== null
      ) {
        return { status: 401, description: "Invalid or expired token" };
      }
      const { grant } = stored;
      if (!(await connectorOn(grant.workspaceId, grant.workspace.settings))) {
        return { status: 403, description: "The connector is turned off in this company" };
      }
      const membership = await prisma.membership.findFirst({
        where: {
          userId: grant.userId,
          workspaceId: grant.workspaceId,
          status: "ACTIVE",
          role: { base: { not: "GUEST" } },
        },
        select: { seatType: true },
      });
      if (membership === null)
        return { status: 403, description: "No longer a member of this company" };
      // Writing needs the grant, a full seat and the paid plugin now (the free one alone reads).
      const canWrite =
        grant.scopes.includes(SCOPES.write) &&
        membership.seatType === "FULL" &&
        (await plugins.hasFeature(grant.workspaceId, "mcp_write"));
      if (grant.lastUsedAt === null || at.getTime() - grant.lastUsedAt.getTime() > 5 * 60_000) {
        await prisma.oAuthGrant.updateMany({ where: { id: grant.id }, data: { lastUsedAt: at } });
      }
      return {
        grantId: grant.id,
        userId: grant.userId,
        workspaceId: grant.workspaceId,
        scopes: canWrite ? [SCOPES.read, SCOPES.write] : [SCOPES.read],
        clientName: grant.client.clientName,
      };
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
