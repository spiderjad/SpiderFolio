// Rate limit en dos niveles (CLAUDE.md, sección 12):
// - Global, en memoria de cada instancia (defensa gruesa contra ráfagas; con N instancias el límite
//   efectivo es N veces el valor, y está bien así): por persona cuando el pedido trae un access token
//   válido (RATE_LIMIT_PER_USER, 300/min), por IP cuando no (RATE_LIMIT_PER_IP, 300/min), y un tope por
//   IP para todo lo que llega con sesión (RATE_LIMIT_PER_SHARED_IP, 6000/min). Por persona y no por IP
//   porque en una planta todas las tablets y móviles salen por la misma IP.
// - Sensibles (login, forgot-password, resend-verification, invitaciones): en Postgres
//   (RateLimitBucket, UNLOGGED), compartidos entre instancias. Las claves se guardan como
//   SHA-256, así la tabla no tiene IPs ni emails.
import type { Request, RequestHandler } from "express";
import {
  ipKeyGenerator,
  rateLimit,
  type AugmentedRequest,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from "express-rate-limit";
import { decrementBucket, incrementBucket } from "../db/raw/rate-limit.ts";
import { sha256 } from "../lib/crypto.ts";
import { AppError } from "../lib/errors.ts";
import { verifyAccessToken } from "../lib/jwt.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import type { AppDeps } from "../routes.ts";

const onLimit: Options["handler"] = (req, res, next) => {
  const resetTime = (req as AugmentedRequest).rateLimit?.resetTime;
  if (resetTime !== undefined) {
    const seconds = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    res.setHeader("Retry-After", String(seconds));
  }
  next(new AppError("RATE_LIMITED"));
};

/**
 * A limit kept only in this process's memory, never written anywhere: for the whistleblowing channel,
 * where the reporter's address must not be stored (docs/spec/canal-denuncias.md).
 */
export function memoryRateLimit(options: {
  windowMs: number;
  limit: number;
  key: (req: Request) => string;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: options.key,
    handler: onLimit,
  });
}

export interface GlobalLimits {
  perUser: number;
  perIp: number;
  perSharedIp: number;
}

const DEFAULT_LIMITS: GlobalLimits = { perUser: 300, perIp: 300, perSharedIp: 6000 };

/**
 * Who a request is for the global limit: the person, if it brings a valid access token (its signature
 * checked: a forged one counts as no session), or else its address. Nothing is read from the database.
 */
function subjectOf(req: Request, secret: string | undefined): { user: string } | { ip: string } {
  const header = req.headers.authorization;
  if (secret !== undefined && header?.startsWith("Bearer ") === true) {
    const claims = verifyAccessToken(header.slice(7).trim(), secret);
    if (claims !== null) return { user: claims.userId };
  }
  return { ip: clientIp(req) };
}

export function globalRateLimit(
  options: { secret?: string; limits?: Partial<GlobalLimits> } = {},
): RequestHandler {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const subject = new WeakMap<Request, { user: string } | { ip: string }>();
  const subjectFor = (req: Request) => {
    let found = subject.get(req);
    if (found === undefined) {
      found = subjectOf(req, options.secret);
      subject.set(req, found);
    }
    return found;
  };
  const own = rateLimit({
    windowMs: 60_000,
    limit: (req) => ("user" in subjectFor(req) ? limits.perUser : limits.perIp),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const found = subjectFor(req);
      return "user" in found ? `user:${found.user}` : `ip:${found.ip}`;
    },
    handler: onLimit,
  });
  // Everything that comes with a session from one address, together (against a farm of accounts).
  const shared = rateLimit({
    windowMs: 60_000,
    limit: limits.perSharedIp,
    standardHeaders: false,
    legacyHeaders: false,
    skip: (req) => !("user" in subjectFor(req)),
    keyGenerator: (req) => `shared:${clientIp(req)}`,
    handler: onLimit,
  });
  return (req, res, next) => {
    void own(req, res, (error?: unknown) => {
      if (error !== undefined) {
        next(error);
        return;
      }
      void shared(req, res, next);
    });
  };
}

export class PostgresStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  #windowMs = 60_000;
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient, prefix: string) {
    this.#prisma = prisma;
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.#windowMs = options.windowMs;
  }

  #key(key: string): string {
    return sha256(`${this.prefix}:${key}`);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const bucket = await incrementBucket(this.#prisma, this.#key(key), this.#windowMs);
    return { totalHits: bucket.hits, resetTime: bucket.resetAt };
  }

  async decrement(key: string): Promise<void> {
    await decrementBucket(this.#prisma, this.#key(key));
  }

  async resetKey(key: string): Promise<void> {
    await this.#prisma.rateLimitBucket.deleteMany({ where: { key: this.#key(key) } });
  }
}

export interface SensitiveLimitOptions {
  /** Nombre del límite (prefijo de la clave), ej. "login-ip-email". */
  name: string;
  windowMs: number;
  limit: number;
  /** Por defecto, la IP (con subred /56 en IPv6). */
  key?: (req: Request) => string;
}

/** IP normalizada para usar dentro de claves compuestas (ej. IP + email). */
export function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? "desconocida");
}

export function sensitiveRateLimit(
  { prisma }: Pick<AppDeps, "prisma">,
  options: SensitiveLimitOptions,
) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new PostgresStore(prisma, options.name),
    keyGenerator: options.key ?? clientIp,
    handler: onLimit,
  });
}
