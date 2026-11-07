// /api/v1/contratas/:accessId — the contractor's portal (docs/spec/cae.md, «Portal de contratas"), before
// and outside any company's routes, like the audit rooms' auditor: never a member's session, only the
// access's own cookie (httpOnly, SameSite=Strict, scoped to this access's path). Code tries are limited
// per access and address and per address; every answer about the link or code is the same.
import express, { type CookieOptions, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { pageShape } from "../../lib/pagination.ts";
import type { AppDeps } from "../../routes.ts";
import { CreateWorkerSchema, UpdateWorkerSchema } from "./cae.schemas.ts";
import {
  enterPortal,
  leavePortal,
  portalArchiveWorker,
  portalCompleteUpload,
  portalCreateWorker,
  portalInfoFile,
  portalOverview,
  portalPermits,
  portalSession,
  portalStartUpload,
  portalUpdateWorker,
  portalWorkers,
  type PortalInfo,
  type PortalSession,
} from "./cae-portal.service.ts";

const COOKIE = "sf_cae_portal";
const MINUTE = 60_000;
const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const AccessParams = z.object({ accessId: Id });
const WorkerParams = z.object({ accessId: Id, workerId: Id });
const NodeParams = z.object({ accessId: Id, nodeId: Id });
const UploadParams = z.object({ accessId: Id, uploadId: Id });
const CodeSchema = z.strictObject({ code: z.string().trim().min(1).max(40) });
const WorkersQuery = z.object({
  ...pageShape(["name"], "name"),
  archived: z.enum(["0", "1"]).default("0"),
});
const PermitsQuery = z.object({ ...pageShape(["validFrom"], "validFrom") });
const StartUploadSchema = z.strictObject({
  requirementId: Id,
  workerId: Id.nullable().default(null),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().min(1),
});
const CompleteUploadSchema = z.strictObject({ validUntil: Day.nullable().default(null) });

function cookieOptions(env: AppDeps["env"], accessId: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/v1/contratas/${accessId}`,
  };
}

const tokenOf = (req: Request): string | undefined => {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[COOKIE];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const infoOf = (req: Request): PortalInfo => ({
  ip: req.ip ?? null,
  userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
});

export function caePortalRouter(deps: AppDeps): Router {
  const router = express.Router();
  const perAccess = (req: Request) => `${String(req.params.accessId)}:${clientIp(req)}`;
  // Code tries: a few per access and address, and per address over every access.
  const enterLimit = sensitiveRateLimit(deps, {
    name: "cae-portal-enter",
    windowMs: 15 * MINUTE,
    limit: 10,
    key: perAccess,
  });
  const enterLimitIp = sensitiveRateLimit(deps, {
    name: "cae-portal-enter-ip",
    windowMs: 15 * MINUTE,
    limit: 30,
    key: (req) => clientIp(req),
  });
  const readLimit = sensitiveRateLimit(deps, {
    name: "cae-portal-read",
    windowMs: MINUTE,
    limit: 120,
    key: perAccess,
  });
  const writeLimit = sensitiveRateLimit(deps, {
    name: "cae-portal-write",
    windowMs: 15 * MINUTE,
    limit: 100,
    key: perAccess,
  });
  const fileDeps = { storage: deps.storage, jobs: deps.jobs };

  /** The session, re-checked; if it was rotated, the new cookie goes with the answer. */
  const session = async (req: Request, res: Response): Promise<PortalSession> => {
    const { accessId } = AccessParams.parse(req.params);
    const current = await portalSession(deps.prisma, accessId, tokenOf(req), infoOf(req));
    if (current.rotated !== null) {
      res.cookie(COOKIE, current.rotated.token, {
        ...cookieOptions(deps.env, accessId),
        expires: current.rotated.expiresAt,
      });
    }
    return current;
  };

  // Whether there's a session (nothing about the company before entering).
  router.get("/:accessId", readLimit, async (req, res) => {
    const signedIn =
      tokenOf(req) !== undefined &&
      (await session(req, res).then(
        () => true,
        () => false,
      ));
    res.setHeader("Cache-Control", "no-store");
    res.json({ signedIn });
  });
  router.post("/:accessId/session", enterLimitIp, enterLimit, async (req, res) => {
    const { accessId } = AccessParams.parse(req.params);
    const { code } = CodeSchema.parse(req.body);
    const entered = await enterPortal(deps.prisma, accessId, code, infoOf(req));
    res.cookie(COOKIE, entered.token, {
      ...cookieOptions(deps.env, accessId),
      expires: entered.expiresAt,
    });
    res.status(204).end();
  });
  router.post("/:accessId/logout", async (req, res) => {
    const { accessId } = AccessParams.parse(req.params);
    await leavePortal(deps.prisma, tokenOf(req));
    res.clearCookie(COOKIE, cookieOptions(deps.env, accessId));
    res.status(204).end();
  });
  router.get("/:accessId/overview", readLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await portalOverview(await session(req, res)));
  });
  router.get("/:accessId/workers", readLimit, async (req, res) => {
    const query = WorkersQuery.parse(req.query);
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await portalWorkers(await session(req, res), { ...query, archived: query.archived === "1" }),
    );
  });
  router.post("/:accessId/workers", writeLimit, async (req, res) => {
    const s = await session(req, res);
    res
      .status(201)
      .json({ worker: await portalCreateWorker(s, CreateWorkerSchema.parse(req.body)) });
  });
  router.patch("/:accessId/workers/:workerId", writeLimit, async (req, res) => {
    const { workerId } = WorkerParams.parse(req.params);
    const s = await session(req, res);
    await portalUpdateWorker(s, workerId, UpdateWorkerSchema.parse(req.body));
    res.status(204).end();
  });
  router.post("/:accessId/workers/:workerId/archive", writeLimit, async (req, res) => {
    const { workerId } = WorkerParams.parse(req.params);
    await portalArchiveWorker(await session(req, res), workerId);
    res.status(204).end();
  });
  router.get("/:accessId/permits", readLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await portalPermits(await session(req, res), PermitsQuery.parse(req.query)));
  });
  router.get("/:accessId/info/:nodeId", readLimit, async (req, res) => {
    const { nodeId } = NodeParams.parse(req.params);
    const file = await portalInfoFile(
      await session(req, res),
      { storage: deps.storage, gotenbergUrl: deps.env.GOTENBERG_URL },
      nodeId,
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="documento.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader("Cache-Control", "no-store");
    // A PDF to read, never something that runs or that another site frames.
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(Buffer.from(file.bytes));
  });
  router.post("/:accessId/uploads", writeLimit, async (req, res) => {
    const input = StartUploadSchema.parse(req.body);
    res
      .status(201)
      .json({ upload: await portalStartUpload(await session(req, res), fileDeps, input) });
  });
  router.post("/:accessId/uploads/:uploadId/complete", writeLimit, async (req, res) => {
    const { uploadId } = UploadParams.parse(req.params);
    const { validUntil } = CompleteUploadSchema.parse(req.body ?? {});
    res.json(await portalCompleteUpload(await session(req, res), fileDeps, uploadId, validUntil));
  });
  return router;
}
