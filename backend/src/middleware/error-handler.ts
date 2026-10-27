// Último middleware: traduce cualquier error al formato único (CLAUDE.md, sección 12).
// Nunca devuelve stack traces, mensajes internos ni errores de Prisma. Express 5 pasa acá
// también los errores de handlers async.
import * as Sentry from "@sentry/node";
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.ts";
import { AppError, errorStatus, type ErrorBody } from "../lib/errors.ts";
import { errorMessages } from "../i18n/index.ts";

const pluginErrorCodes = ["BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT"] as const;

/** Convierte un error cualquiera en AppError; null si es inesperado (500). */
export function toAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;

  // Errores de un plugin (PluginError del SDK): por nombre, el plugin puede traer su propia copia.
  if (error instanceof Error && error.name === "PluginError" && "code" in error) {
    const code = pluginErrorCodes.find((c) => c === error.code);
    if (code !== undefined) {
      return new AppError(code, error.message === code ? {} : { message: error.message });
    }
  }

  if (error instanceof ZodError) {
    return new AppError("VALIDATION_ERROR", {
      // Ruta y código de cada problema; nunca el valor recibido.
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          code: issue.code,
          message: issue.message,
        })),
      },
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return new AppError("NOT_FOUND");
    if (error.code === "P2002" || error.code === "P2003") return new AppError("CONFLICT");
    return null;
  }

  // Errores de express.json (body-parser).
  if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.too.large") return new AppError("PAYLOAD_TOO_LARGE");
    if (error.type === "entity.parse.failed") return new AppError("BAD_REQUEST");
  }
  return null;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const appError = toAppError(error);
    if (appError === null) {
      logger.error({ err: error, requestId: req.requestId }, "Error inesperado");
      Sentry.captureException(error);
    }
    const code = appError?.code ?? "INTERNAL";
    const body: ErrorBody = {
      error: {
        code,
        message: appError?.message ?? errorMessages.INTERNAL,
        ...(appError?.details === undefined ? {} : { details: appError.details }),
        requestId: req.requestId,
      },
    };
    res.status(errorStatus[code]).json(body);
  };
}

export const notFoundHandler: RequestHandler = () => {
  throw new AppError("NOT_FOUND");
};
