// The applications that connect (docs/spec/conector-mcp.md «Registro del cliente»): registered
// dynamically (RFC 7591) or identified by a Client ID Metadata Document, an HTTPS URL whose JSON names
// the client and its redirect URIs. Fetching that document is the only request the server makes on a
// client's behalf: HTTPS only, never to a private or local address (checked on the address actually
// connected to), no redirects, small and quick, and cached a day.
import { lookup } from "node:dns";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { z } from "zod";
import { randomToken } from "../../lib/crypto.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

const METADATA_MAX_BYTES = 10_000;
const METADATA_TIMEOUT_MS = 5_000;
const METADATA_CACHE_MS = 24 * 3600_000;
const MAX_REDIRECT_URIS = 10;

export class OAuthClientError extends Error {
  readonly code: "invalid_client" | "invalid_redirect_uri" | "invalid_client_metadata";
  constructor(code: OAuthClientError["code"]) {
    super(code);
    this.name = "OAuthClientError";
    this.code = code;
  }
}

export interface ResolvedClient {
  /** OAuthClient.id */
  id: string;
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

/** A redirect URI clients may register: HTTPS, or a loopback address over HTTP (native apps). */
export function validRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== "" || url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopback(url.hostname);
}

const isLoopback = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/**
 * The redirect URI of a request against the registered ones: an exact match, except loopback ones,
 * which match on any port (RFC 8252 §7.3; Claude Code picks a port per session).
 */
export function redirectUriAllowed(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let wanted: URL;
  try {
    wanted = new URL(requested);
  } catch {
    return false;
  }
  if (wanted.protocol !== "http:" || !isLoopback(wanted.hostname)) return false;
  return registered.some((uri) => {
    const allowed = new URL(uri);
    return (
      allowed.protocol === "http:" &&
      allowed.hostname === wanted.hostname &&
      allowed.pathname === wanted.pathname &&
      allowed.search === wanted.search
    );
  });
}

/** Only loopback redirect URIs: the consent screen warns (any local program can claim them). */
export const onlyLoopback = (uris: readonly string[]) =>
  uris.every((uri) => new URL(uri).protocol === "http:");

const RegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(MAX_REDIRECT_URIS),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

/** RFC 7591 registration: a public client (no secret) with the redirect URIs it lists. */
export async function registerClient(prisma: PrismaClient, body: unknown) {
  const parsed = RegistrationSchema.safeParse(body);
  if (!parsed.success) throw new OAuthClientError("invalid_client_metadata");
  const metadata = parsed.data;
  if (!metadata.redirect_uris.every(validRedirectUri)) {
    throw new OAuthClientError("invalid_redirect_uri");
  }
  const grantTypes = metadata.grant_types ?? ["authorization_code", "refresh_token"];
  if (!grantTypes.every((type) => type === "authorization_code" || type === "refresh_token")) {
    throw new OAuthClientError("invalid_client_metadata");
  }
  const client = await prisma.oAuthClient.create({
    data: {
      clientId: `sf_${randomToken(24)}`,
      kind: "REGISTERED",
      clientName: metadata.client_name ?? "Aplicación",
      redirectUris: metadata.redirect_uris,
    },
  });
  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

// ─── Client ID Metadata Documents ──────────────────────────────────────────────────────

/** A client_id that is a metadata document URL: HTTPS with a path, no fragment or credentials. */
export function isMetadataDocumentUrl(clientId: string): boolean {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.pathname !== "/" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
}

/** Addresses a fetch must never reach: loopback, private, link-local, unique-local, multicast… */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPublicAddress(v6.slice(7));
  return !(
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff")
  );
}

/**
 * DNS lookup that fails if any resolved address isn't public: the check holds for the address connected
 * to. Node asks for every address (`all: true`, for autoSelectFamily) or for one, and expects the
 * answer in the same shape.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error !== null) {
      callback(error, "", 0);
      return;
    }
    const [first] = addresses;
    if (first === undefined || !addresses.every((entry) => isPublicAddress(entry.address))) {
      callback(new Error("Dirección no pública"), "", 0);
      return;
    }
    if (options.all === true) {
      callback(null, addresses);
      return;
    }
    callback(null, first.address, first.family);
  });
};

/** GETs a metadata document over HTTPS: public addresses only, no redirects, size and time capped. */
export type MetadataFetcher = (url: string) => Promise<unknown>;

export const fetchMetadataDocument: MetadataFetcher = (url) =>
  new Promise((resolve, reject) => {
    // Node doesn't call `lookup` for an IP literal, so that address is checked here.
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) !== 0 && !isPublicAddress(host)) {
      reject(new Error("Dirección no pública"));
      return;
    }
    const req = request(
      url,
      {
        method: "GET",
        lookup: publicOnlyLookup,
        timeout: METADATA_TIMEOUT_MS,
        headers: { accept: "application/json" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${String(res.statusCode)}`));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > METADATA_MAX_BYTES) {
            req.destroy(new Error("Documento demasiado grande"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error instanceof Error ? error : new Error("JSON inválido"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Tiempo agotado")));
    req.on("error", reject);
    req.end();
  });

const MetadataDocumentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.string().max(500)).min(1).max(MAX_REDIRECT_URIS),
});

/**
 * The client behind a client_id: a registered one, or the one its metadata document describes (read
 * again when the cached copy is a day old). Throws invalid_client if there's none.
 */
export async function resolveClient(
  prisma: PrismaClient,
  clientId: string,
  fetcher: MetadataFetcher = fetchMetadataDocument,
  now: Date = new Date(),
): Promise<ResolvedClient> {
  const known = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (known !== null && known.kind === "REGISTERED") return known;
  if (!isMetadataDocumentUrl(clientId)) throw new OAuthClientError("invalid_client");
  if (known?.fetchedAt != null && now.getTime() - known.fetchedAt.getTime() < METADATA_CACHE_MS) {
    return known;
  }
  let document: z.infer<typeof MetadataDocumentSchema>;
  try {
    document = MetadataDocumentSchema.parse(await fetcher(clientId));
  } catch {
    // An unreachable document keeps a previous copy working; a client never seen fails.
    if (known !== null) return known;
    throw new OAuthClientError("invalid_client");
  }
  if (document.client_id !== clientId || !document.redirect_uris.every(validRedirectUri)) {
    throw new OAuthClientError("invalid_client");
  }
  const data = {
    kind: "METADATA_DOCUMENT",
    clientName: document.client_name,
    redirectUris: document.redirect_uris,
    fetchedAt: now,
  };
  return await prisma.oAuthClient.upsert({
    where: { clientId },
    create: { clientId, ...data },
    update: data,
  });
}
