// Utilidades de los tests de integración: dependencias reales sobre la base de tests.
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { licenseSigningInput, toBase64Url } from "@spiderfolio/plugin-sdk";
import type { BackendPlugin } from "@spiderfolio/plugin-sdk/backend";
import type { LimitKey } from "@spiderfolio/limits";
import type { PgBoss } from "pg-boss";
import { loadEnv, type Env } from "../../src/config/env.ts";
import { createBoss, createJobs, ensureQueues, type BossRole } from "../../src/jobs/boss.ts";
import { signAccessToken } from "../../src/lib/jwt.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { createStorage, createSystemStorage } from "../../src/lib/storage.ts";
import { createPrismaClient, type PrismaClient } from "../../src/lib/prisma.ts";
import { createPasswords } from "../../src/modules/auth/passwords.ts";
import { createWorkspace as createWorkspaceRecord } from "../../src/modules/workspaces/workspaces.service.ts";
import type { AppDeps } from "../../src/routes.ts";
import {
  createPluginRuntime,
  emptyPluginRuntime,
  type PluginRuntime,
} from "../../src/plugins/runtime.ts";

export interface TestContext {
  deps: AppDeps;
  prisma: PrismaClient;
  boss: PgBoss;
  close(): Promise<void>;
}

/**
 * pg-boss for tests, with an error listener like server.ts and worker.ts: a LISTEN/NOTIFY heartbeat
 * timeout under load is reported as an "error" event (pg-boss reconnects on its own), and without a
 * listener it would surface as an unhandled rejection.
 */
export function createTestBoss(
  connectionString: string,
  role: BossRole,
): ReturnType<typeof createBoss> {
  const boss = createBoss(connectionString, role);
  boss.on("error", () => {
    // Reconnection is handled by pg-boss; the tests assert on job outcomes, not on the connection.
  });
  return boss;
}

export async function createTestContext(): Promise<TestContext> {
  const env: Env = loadEnv(process.env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const boss = createTestBoss(env.DATABASE_URL, "api");
  await boss.start();
  await ensureQueues(boss);
  const logger = createLogger(env);
  const deps: AppDeps = {
    env,
    prisma,
    logger,
    plugins: emptyPluginRuntime(prisma, logger),
    jobs: createJobs(boss),
    passwords: await createPasswords(),
    storage: createStorage(),
    systemStorage: createSystemStorage(),
  };
  return {
    deps,
    prisma,
    boss,
    async close() {
      await boss.stop({ graceful: false });
      await prisma.$disconnect();
    },
  };
}

/**
 * Runtime de plugins para tests: los plugins dados (definidos en el test, nunca los de plugins/) y una
 * licencia firmada con una clave efímera para cada workspace de `licensed`.
 */
export async function testPluginRuntime(
  ctx: TestContext,
  plugins: readonly BackendPlugin[],
  licensed: readonly string[] = [],
  /** Ids de los plugins que se declaran «community» (sin licencia; los activa el propietario). */
  community: readonly string[] = [],
): Promise<PluginRuntime> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  for (const workspaceId of licensed) {
    const input = licenseSigningInput({
      id: `LIC-TEST-${randomUUID().slice(0, 8)}`,
      customer: "Empresa de prueba",
      plugins: plugins.map((plugin) => plugin.id),
      issuedAt: new Date().toISOString(),
      expiresAt: null,
    });
    const token = `${input}.${toBase64Url(sign(null, Buffer.from(input), privateKey))}`;
    await ctx.prisma.workspaceLicense.upsert({
      where: { workspaceId },
      create: { workspaceId, token },
      update: { token },
    });
  }
  return createPluginRuntime({
    prisma: ctx.prisma,
    logger: ctx.deps.logger,
    publicKey,
    installed: plugins.map((backend) => ({
      manifest: {
        id: backend.id,
        name: backend.id,
        description: "",
        distribution: community.includes(backend.id) ? "community" : "commercial",
        translations: {},
        pluginApi: 1,
      },
      dir: "",
      version: backend.version,
      backend,
      migrations: [],
      frontendBundle: null,
    })),
  });
}

/** Fija límites de la empresa (Workspace.limits); sin esto no hay ninguno. */
export async function setLimits(
  ctx: TestContext,
  workspaceId: string,
  limits: Partial<Record<LimitKey, number | null>>,
): Promise<void> {
  await ctx.prisma.workspace.update({ where: { id: workspaceId }, data: { limits } });
}

export const uniqueEmail = (label = "persona") => `${label}-${randomUUID()}@test.local`;

export async function createUser(prisma: PrismaClient, name = "Persona de prueba") {
  const email = uniqueEmail();
  const user = await prisma.user.create({
    data: { email, name, passwordHash: "sin-uso-en-estos-tests" },
  });
  // El email de User es opcional (usuarios de PIN); estos usuarios siempre lo tienen.
  return { ...user, email };
}

/** Sesión activa y access token válido para el usuario. */
export async function loginAs(ctx: TestContext, userId: string): Promise<string> {
  const session = await ctx.prisma.session.create({
    data: {
      userId,
      familyId: randomUUID(),
      familyCreatedAt: new Date(),
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return signAccessToken(
    { userId, sessionId: session.id },
    ctx.deps.env.JWT_ACCESS_SECRET,
    ctx.deps.env.JWT_ACCESS_TTL,
  );
}

/** Workspace con su dueño ya logueado. */
export async function createWorkspace(ctx: TestContext, name = "Empresa de prueba") {
  const owner = await createUser(ctx.prisma, `Dueño de ${name}`);
  const created = await createWorkspaceRecord(ctx.prisma, {
    name,
    ownerUserId: owner.id,
    settings: { timezone: "Europe/Madrid", locale: "es" },
  });
  const token = await loginAs(ctx, owner.id);
  return { ...created, owner, token };
}

export const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025/api/v1";

export interface MailpitMessage {
  ID: string;
  Subject: string;
}

/** Espera el email más reciente para `to` (opcionalmente con ese asunto) y devuelve su texto. */
export async function waitForEmail(
  to: string,
  subject?: string,
  timeoutMs = 15_000,
): Promise<{ message: MailpitMessage; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const query = `to:"${to}"${subject === undefined ? "" : ` subject:"${subject}"`}`;
    const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(query)}`);
    const body = (await res.json()) as { messages: MailpitMessage[] };
    const message = body.messages[0];
    if (message !== undefined) {
      const detail = (await (await fetch(`${MAILPIT_API}/message/${message.ID}`)).json()) as {
        Text: string;
        HTML: string;
      };
      return { message, text: detail.Text, html: detail.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No llegó el email a ${to}${subject === undefined ? "" : ` (${subject})`}`);
}

export async function countEmails(to: string): Promise<number> {
  const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await res.json()) as { messages_count: number }).messages_count;
}

/** Token de un enlace de email (va en el fragmento #token=…). */
export function tokenFromEmail(text: string): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(text);
  if (match?.[1] === undefined) throw new Error("El email no trae un enlace con token");
  return match[1];
}

export type TestWorkspace = Awaited<ReturnType<typeof createWorkspace>>;

/** Agrega una persona al workspace con un rol de sistema (por base) o uno ya creado. */
export async function addMember(
  ctx: TestContext,
  ws: Pick<TestWorkspace, "workspaceId">,
  options: {
    base?: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
    roleId?: string;
    seatType?: "FULL" | "READER";
    status?: "ACTIVE" | "SUSPENDED";
    name?: string;
  } = {},
) {
  const role =
    options.roleId === undefined
      ? await ctx.prisma.role.findFirstOrThrow({
          where: {
            workspaceId: ws.workspaceId,
            base: options.base ?? "MEMBER",
            isSystem: true,
          },
        })
      : await ctx.prisma.role.findFirstOrThrow({
          where: { workspaceId: ws.workspaceId, id: options.roleId },
        });
  const user = await createUser(ctx.prisma, options.name ?? "Miembro de prueba");
  const membership = await ctx.prisma.membership.create({
    data: {
      userId: user.id,
      workspaceId: ws.workspaceId,
      roleId: role.id,
      seatType: options.seatType ?? (role.base === "GUEST" ? "READER" : "FULL"),
      status: options.status ?? "ACTIVE",
    },
  });
  const token = await loginAs(ctx, user.id);
  return { user, membership, role, token };
}
