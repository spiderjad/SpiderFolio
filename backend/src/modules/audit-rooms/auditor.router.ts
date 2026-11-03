// /api/v1/auditor/:roomId — the external auditor (docs/spec/salas-de-auditoria.md), before and outside
// any company's routes: never a member's session, only the room's own cookie (scoped to this room's path).
import express, { type CookieOptions, type Request, type Router } from "express";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps } from "../../routes.ts";
import {
  auditorSession,
  enterWithCode,
  leaveRoom,
  requestCode,
  roomCover,
  roomItemFile,
  roomItems,
  type AuditorInfo,
} from "./auditor.service.ts";
import {
  AuditorCodeSchema,
  AuditorItemParamsSchema,
  AuditorPdfQuerySchema,
  AuditorRoomParamsSchema,
} from "./rooms.schemas.ts";

const COOKIE = "sf_auditor";
const MINUTE = 60_000;

function cookieOptions(env: AppDeps["env"], roomId: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/v1/auditor/${roomId}`,
  };
}

const tokenOf = (req: Request): string | undefined => {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[COOKIE];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const infoOf = (req: Request): AuditorInfo => ({
  ip: req.ip ?? null,
  userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
});

export function auditorRouter(deps: AppDeps): Router {
  const router = express.Router();
  const perRoom = (req: Request) => `${String(req.params.roomId)}:${clientIp(req)}`;
  // Codes: a few per room and address (each one is an email to the auditor).
  const codeLimit = sensitiveRateLimit(deps, {
    name: "auditor-code",
    windowMs: 15 * MINUTE,
    limit: 5,
    key: perRoom,
  });
  const enterLimit = sensitiveRateLimit(deps, {
    name: "auditor-enter",
    windowMs: 15 * MINUTE,
    limit: 20,
    key: perRoom,
  });
  const readLimit = sensitiveRateLimit(deps, {
    name: "auditor-read",
    windowMs: MINUTE,
    limit: 120,
    key: perRoom,
  });
  const render = {
    prisma: deps.prisma,
    storage: deps.storage,
    gotenbergUrl: deps.env.GOTENBERG_URL,
  };
  const session = (req: Request) =>
    auditorSession(
      deps.prisma,
      AuditorRoomParamsSchema.parse(req.params).roomId,
      tokenOf(req),
      infoOf(req),
    );

  router.get("/:roomId", readLimit, async (req, res) => {
    const { roomId } = AuditorRoomParamsSchema.parse(req.params);
    const cover = await roomCover(deps.prisma, roomId);
    let signedIn = false;
    if (cover.open && tokenOf(req) !== undefined) {
      signedIn = await session(req).then(
        () => true,
        () => false,
      );
    }
    res.json({ room: cover, signedIn });
  });
  router.post("/:roomId/code", codeLimit, async (req, res) => {
    const { roomId } = AuditorRoomParamsSchema.parse(req.params);
    await requestCode(deps, roomId);
    res.status(204).end();
  });
  router.post("/:roomId/session", enterLimit, async (req, res) => {
    const { roomId } = AuditorRoomParamsSchema.parse(req.params);
    const { code } = AuditorCodeSchema.parse(req.body);
    const entered = await enterWithCode(deps.prisma, roomId, code, infoOf(req));
    res.cookie(COOKIE, entered.token, {
      ...cookieOptions(deps.env, roomId),
      expires: entered.expiresAt,
    });
    res.status(204).end();
  });
  router.post("/:roomId/logout", async (req, res) => {
    const { roomId } = AuditorRoomParamsSchema.parse(req.params);
    await leaveRoom(deps.prisma, tokenOf(req));
    res.clearCookie(COOKIE, cookieOptions(deps.env, roomId));
    res.status(204).end();
  });
  router.get("/:roomId/items", readLimit, async (req, res) => {
    res.json(await roomItems(await session(req)));
  });
  router.get("/:roomId/items/:itemId/pdf", readLimit, async (req, res) => {
    const { itemId } = AuditorItemParamsSchema.parse(req.params);
    const query = AuditorPdfQuerySchema.parse(req.query);
    const download = query.download === "1";
    const file = await roomItemFile(
      await session(req),
      render,
      itemId,
      { nodeId: query.node, download },
      infoOf(req),
    );
    const name = encodeURIComponent(file.fileName);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="auditoria.pdf"; filename*=UTF-8''${name}`,
    );
    res.setHeader("Cache-Control", "no-store");
    // Shown inside the room's viewer only, never framed by another site.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(Buffer.from(file.body));
  });
  return router;
}
