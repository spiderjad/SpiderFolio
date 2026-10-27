// /api/v1/internal: backoffice de quien administra la instalación (docs/spec/operacion.md, 12A.3). Solo
// para usuarios con User.isStaff = true; cualquier otra persona recibe 404 (no se revela que existe).
// Exige verificación en dos pasos. Pendiente (12A.3): restringir por IP.
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { AppError, notFound } from "../../lib/errors.ts";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { authMiddleware } from "../../middleware/auth.ts";

import type { AppDeps } from "../../routes.ts";
import { listWorkspaces } from "./internal.service.ts";

const WorkspacesQuerySchema = z.object({
  q: SearchParam,
  ...pageShape(["name"], "name", { defaultPageSize: 25 }),
});


export function internalRouter(deps: AppDeps): Router {
  const { prisma } = deps;
  const router = Router();

  /** Solo el equipo: se comprueba en la base en cada pedido (quitar el permiso corta el acceso). */
  const requireStaff: RequestHandler = async (req, _res, next) => {
    const user =
      req.auth === undefined
        ? null
        : await prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: { isStaff: true, totpEnabledAt: true },
          });
    if (user?.isStaff !== true) throw notFound();
    // El backoffice exige verificación en dos pasos (12A.3).
    if (user.totpEnabledAt === null) throw new AppError("MFA_SETUP_REQUIRED");
    next();
  };
  router.use(authMiddleware(deps), requireStaff);


  router.get("/me", (_req, res) => {
    res.json({ staff: true });
  });

  router.get("/workspaces", async (req, res) => {
    res.json(await listWorkspaces(deps, WorkspacesQuerySchema.parse(req.query)));
  });

  return router;
}
