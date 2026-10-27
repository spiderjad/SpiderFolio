// Defensa contra CSRF en los endpoints que actúan solo con la cookie (refresh y logout,
// CLAUDE.md sección 7.2): además de SameSite=Strict, exigen la cabecera
// X-Requested-With: spiderfolio (un formulario de otro sitio no puede ponerla sin preflight) y un
// Origin igual a APP_URL.
import type { RequestHandler } from "express";
import type { Env } from "../config/env.ts";
import { forbidden } from "../lib/errors.ts";

export function requireSameOrigin(env: Pick<Env, "APP_URL">): RequestHandler {
  const expected = new URL(env.APP_URL).origin;
  return (req, _res, next) => {
    if (req.get("x-requested-with") !== "spiderfolio" || req.get("origin") !== expected) {
      throw forbidden();
    }
    next();
  };
}
