// Rate limit en dos niveles (CLAUDE.md, sección 12):
// - Global (300/min por IP): en memoria de cada instancia. Es una defensa gruesa contra
//   ráfagas; con N instancias el límite efectivo es N × 300, y está bien así.
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

export function globalRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: onLimit,
  });
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
