// The connector's OAuth 2.1 server (docs/spec/conector-mcp.md): one issuer (APP_URL) and one protected
// resource, the MCP endpoint (APP_URL/mcp). Tokens are only ever issued for that resource.
import type { Env } from "../../config/env.ts";

export const MCP_PATH = "/mcp";

export const SCOPES = {
  read: "docs:read",
  write: "docs:write",
} as const;
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];
export const ALL_SCOPES: readonly Scope[] = [SCOPES.read, SCOPES.write];

export const ACCESS_TOKEN_SECONDS = 3600;
export const REFRESH_TOKEN_DAYS = 30;
/** How long the person has to approve, and the authorization code to be exchanged. */
export const REQUEST_MINUTES = 10;
export const CODE_SECONDS = 120;

/** The issuer and the resource, without a trailing slash (RFC 8414, RFC 8707). */
export function oauthUrls(env: Pick<Env, "APP_URL">) {
  const issuer = new URL(env.APP_URL).origin;
  return {
    issuer,
    resource: `${issuer}${MCP_PATH}`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource${MCP_PATH}`,
    authorize: `${issuer}/oauth/authorize`,
    token: `${issuer}/oauth/token`,
    register: `${issuer}/oauth/register`,
    revoke: `${issuer}/oauth/revoke`,
    /** The app's consent screen (frontend/src/features/oauth). */
    consent: `${issuer}/authorize-app`,
  };
}

/**
 * A resource URI as clients send it, in canonical form: lowercase scheme and host, no trailing slash,
 * no fragment. null if it isn't an absolute http(s) URI.
 */
export function canonicalResource(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hash !== "") return null;
  const path = url.pathname.replace(/\/+$/u, "");
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}
