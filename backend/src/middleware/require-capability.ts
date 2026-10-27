import type { RequestHandler } from "express";
import { forbidden } from "../lib/errors.ts";
import type { Capability } from "../modules/roles/capabilities.ts";
import { peopleScopeOf } from "../modules/people/people-scope.ts";
import { tenantOf } from "./tenant.ts";

/** 403 si a la persona le falta alguna de las capacidades (CLAUDE.md, sección 9.2). */
export function requireCapability(...required: Capability[]): RequestHandler {
  return (req, _res, next) => {
    const { tenant } = tenantOf(req);
    if (!required.every((capability) => tenant.capabilities.includes(capability))) {
      throw forbidden();
    }
    next();
  };
}

/** 403 si a la persona no le alcanza ninguna de las capacidades. */
export function requireAnyCapability(...allowed: Capability[]): RequestHandler {
  return (req, _res, next) => {
    const { tenant } = tenantOf(req);
    if (!allowed.some((capability) => tenant.capabilities.includes(capability))) throw forbidden();
    next();
  };
}

/** 403 si quien pide no es propietario (seguridad, facturación y borrar el workspace). */
export function requireOwner(): RequestHandler {
  return (req, _res, next) => {
    if (tenantOf(req).tenant.role.base !== "OWNER") throw forbidden();
    next();
  };
}

/**
 * Como requireAnyCapability, pero también deja pasar a todo miembro con plaza completa (no a
 * lectores ni invitados): lee la estructura de la empresa según "Los miembros ven". El servicio
 * decide qué ve y qué puede hacer (docs/spec/personas.md).
 */
export function requireAnyCapabilityOrMember(...allowed: Capability[]): RequestHandler {
  return async (req, _res, next) => {
    const { tenant, db } = tenantOf(req);
    if (allowed.some((capability) => tenant.capabilities.includes(capability))) {
      next();
      return;
    }
    if ((await peopleScopeOf({ db, tenant })).directory !== "self") {
      next();
      return;
    }
    throw forbidden();
  };
}

/**
 * Como requireAnyCapability, pero también deja pasar a quien lidera un departamento (jefe o
 * subjefe): su alcance lo decide después el servicio (docs/spec/personas.md).
 */
export function requireAnyCapabilityOrLeader(...allowed: Capability[]): RequestHandler {
  return async (req, _res, next) => {
    const { tenant, db } = tenantOf(req);
    if (allowed.some((capability) => tenant.capabilities.includes(capability))) {
      next();
      return;
    }
    if ((await peopleScopeOf({ db, tenant })).manage.kind === "own") {
      next();
      return;
    }
    throw forbidden();
  };
}
