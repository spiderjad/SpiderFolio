// /api/v1/canal/:workspaceSlug — the whistleblowing channel's public side (docs/spec/canal-denuncias.md):
// before and outside any company's routes, never a member's session. Nothing here keeps the reporter's
// address: the request log skips these paths (app.ts) and the attempt limits live only in memory.
import { whistleblowingLimits } from "@spiderfolio/limits";
import express, { type CookieOptions, type Request, type Router } from "express";
import { z } from "zod";
import { clientIp, memoryRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps } from "../../routes.ts";
import {
  channelPage,
  createReport,
  enterMailbox,
  leaveMailbox,
  mailboxSession,
  mailboxView,
  reporterMessage,
} from "./reporter.service.ts";

const L = whistleblowingLimits;
const COOKIE = "sf_channel_mailbox";
const MINUTE = 60_000;

const SlugParams = z.object({ workspaceSlug: z.string().min(1).max(80) });
const Field = (max: number) => z.string().trim().max(max).default("");

const ReportSchema = z.strictObject({
  category: z.string().trim().min(1).max(L.categoryMax),
  account: z.string().trim().min(1).max(L.bodyMax),
  people: Field(L.fieldMax),
  when: Field(L.fieldMax),
  where: Field(L.fieldMax),
  contact: z
    .strictObject({
      name: z.string().trim().min(1).max(L.contactMax),
      contact: z.string().trim().max(L.contactMax).default(""),
    })
    .nullable()
    .default(null),
  excluded: z.array(z.string().min(1).max(64)).max(L.managersMax).default([]),
  password: z.string().min(L.passwordMin).max(L.passwordMax),
});

const LoginSchema = z.strictObject({
  code: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(L.passwordMax),
});

const MessageSchema = z.strictObject({ body: z.string().trim().min(1).max(L.messageMax) });

function cookieOptions(env: AppDeps["env"], slug: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/v1/canal/${slug}/mailbox`,
  };
}

const tokenOf = (req: Request): string | undefined => {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[COOKIE];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const memoryLimit = (windowMs: number, limit: number, key: (req: Request) => string) =>
  memoryRateLimit({ windowMs, limit, key });

export function reporterRouter(deps: AppDeps): Router {
  const router = express.Router();
  const perSlug = (req: Request) => `${String(req.params.workspaceSlug)}:${clientIp(req)}`;
  const readLimit = memoryLimit(MINUTE, 60, perSlug);
  const reportLimit = memoryLimit(60 * MINUTE, L.reportsPerHour, perSlug);
  const loginLimit = memoryLimit(15 * MINUTE, 10, perSlug);
  const loginLimitIp = memoryLimit(15 * MINUTE, 30, (req) => clientIp(req));
  const writeLimit = memoryLimit(15 * MINUTE, 30, perSlug);

  router.get("/:workspaceSlug", readLimit, async (req, res) => {
    const { workspaceSlug } = SlugParams.parse(req.params);
    res.json({ page: await channelPage(deps, workspaceSlug) });
  });
  router.post("/:workspaceSlug/reports", reportLimit, async (req, res) => {
    const { workspaceSlug } = SlugParams.parse(req.params);
    const input = ReportSchema.parse(req.body);
    res.status(201).json(await createReport(deps, workspaceSlug, input));
  });
  router.post("/:workspaceSlug/mailbox/login", loginLimitIp, loginLimit, async (req, res) => {
    const { workspaceSlug } = SlugParams.parse(req.params);
    const { code, password } = LoginSchema.parse(req.body);
    const entered = await enterMailbox(deps, workspaceSlug, code, password);
    res.cookie(COOKIE, entered.token, {
      ...cookieOptions(deps.env, workspaceSlug),
      expires: entered.expiresAt,
    });
    res.status(204).end();
  });
  router.get("/:workspaceSlug/mailbox", readLimit, async (req, res) => {
    const { workspaceSlug } = SlugParams.parse(req.params);
    const session = await mailboxSession(deps, workspaceSlug, tokenOf(req));
    res.cookie(COOKIE, tokenOf(req) ?? "", {
      ...cookieOptions(deps.env, workspaceSlug),
      expires: session.expiresAt,
    });
    res.json({ mailbox: await mailboxView(deps, session) });
  });
  router.post("/:workspaceSlug/mailbox/messages", writeLimit, async (req, res) => {
    const { workspaceSlug } = SlugParams.parse(req.params);
    const { body } = MessageSchema.parse(req.body);
    const session = await mailboxSession(deps, workspaceSlug, tokenOf(req));
    await reporterMessage(deps, session, body);
    res.json({ mailbox: await mailboxView(deps, session) });
  });
  router.post("/:workspaceSlug/mailbox/logout", async (req, res) => {
    const { workspaceSlug } = SlugParams.parse(req.params);
    await leaveMailbox(deps.prisma, tokenOf(req));
    res.clearCookie(COOKIE, cookieOptions(deps.env, workspaceSlug));
    res.status(204).end();
  });
  return router;
}
