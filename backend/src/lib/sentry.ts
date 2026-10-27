// Sentry solo si hay DSN (CLAUDE.md, sección 12A.4): sin datos personales ni contenido.
import * as Sentry from "@sentry/node";
import type { Env } from "../config/env.ts";

export function initSentry(env: Pick<Env, "SENTRY_DSN" | "NODE_ENV">): void {
  if (env.SENTRY_DSN === undefined) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
    // Sentry 11 recolecta todo esto por defecto: lo apagamos. Solo viajan el error y su stack.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
  });
}
