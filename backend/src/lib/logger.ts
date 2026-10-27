// Logs estructurados con pino (CLAUDE.md, sección 12): nunca secretos ni contenido.
import { pino, type Logger } from "pino";
import type { Env } from "../config/env.ts";

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "passwordHash",
  "token",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "smtpPass",
  "smtpPassEnc",
  "*.smtpPass",
  "*.smtpPassEnc",
];

export function createLogger(env: Pick<Env, "NODE_ENV">): Logger {
  return pino({
    level: env.NODE_ENV === "test" ? "silent" : "info",
    redact: { paths: REDACT_PATHS, censor: "[oculto]" },
  });
}
