import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/** Id por request para logs y para el campo requestId de los errores. Nunca se confía en el
 * que manda el cliente: se genera siempre y se devuelve en X-Request-Id. */
export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};
