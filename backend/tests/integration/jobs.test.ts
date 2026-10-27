// pg-boss y el mailer: encolado transaccional, worker → Mailpit y limpieza.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupExpired } from "../../src/jobs/handlers.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { createMailer } from "../../src/lib/mailer.ts";
import { startWorker } from "../../src/worker.ts";
import { forTenant, TenantViolation } from "../../src/db/tenant.ts";
import {
  createTestBoss,
  createTestContext,
  createUser,
  createWorkspace,
  type TestContext,
} from "./helpers.ts";

const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025/api/v1";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

async function jobsFor(userId: string): Promise<number> {
  const rows = await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM pgboss.job WHERE name = 'email-send' AND data->>'userId' = $1`,
    userId,
  );
  return Number(rows[0]?.n ?? 0);
}

async function waitForEmail(to: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as { messages: { ID: string; Subject: string }[] };
    if (body.messages.length > 0) return body.messages[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No llegó el email a ${to}`);
}

describe("encolado dentro de una transacción", () => {
  it("si la transacción se revierte, el job no existe", async () => {
    const user = await createUser(ctx.prisma);
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await ctx.deps.jobs.enqueue(
          "email-send",
          { kind: "password-changed", userId: user.id },
          { tx },
        );
        throw new Error("revertir");
      }),
    ).rejects.toThrow("revertir");
    expect(await jobsFor(user.id)).toBe(0);
  });

  it("si se confirma, el job queda encolado junto con los datos", async () => {
    const user = await createUser(ctx.prisma);
    await ctx.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name: "Actualizada" } });
      await ctx.deps.jobs.enqueue(
        "email-send",
        { kind: "password-changed", userId: user.id },
        { tx },
      );
    });
    expect(await jobsFor(user.id)).toBe(1);
  });

  it("desde un servicio de tenant: encola con el TenantDb de db.$transaction", async () => {
    const ws = await createWorkspace(ctx, "Encolado tenant");
    const db = forTenant(ctx.prisma, ws.workspaceId);
    await db.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: ws.membershipId }, data: { jobTitle: "Calidad" } });
      await ctx.deps.jobs.enqueue(
        "email-send",
        { kind: "password-changed", userId: ws.owner.id },
        { tx },
      );
    });
    expect(await jobsFor(ws.owner.id)).toBe(1);

    const other = await createWorkspace(ctx, "Encolado tenant revertido");
    await expect(
      forTenant(ctx.prisma, other.workspaceId).$transaction(async (tx) => {
        await ctx.deps.jobs.enqueue(
          "email-send",
          { kind: "password-changed", userId: other.owner.id },
          { tx },
        );
        throw new Error("revertir");
      }),
    ).rejects.toThrow("revertir");
    expect(await jobsFor(other.owner.id)).toBe(0);
  });

  it("con un TenantDb fuera de una transacción, enqueue falla", async () => {
    const ws = await createWorkspace(ctx, "Encolado sin transacción");
    await expect(
      ctx.deps.jobs.enqueue(
        "email-send",
        { kind: "password-changed", userId: ws.owner.id },
        { tx: forTenant(ctx.prisma, ws.workspaceId) },
      ),
    ).rejects.toThrow(TenantViolation);
  });

  it("valida el payload: nada de secretos ni campos extra", async () => {
    await expect(
      ctx.deps.jobs.enqueue("email-send", {
        kind: "password-changed",
        userId: "u1",
        token: "secreto",
      } as never),
    ).rejects.toThrow();
  });
});

describe("worker", () => {
  it("procesa el email y llega a Mailpit con HTML escapado y texto plano", async () => {
    const worker = createTestBoss(ctx.deps.env.DATABASE_URL, "worker");
    await worker.start();
    try {
      await startWorker(worker, {
        prisma: ctx.prisma,
        mailer: createMailer(ctx.deps.env),
        logger: createLogger(ctx.deps.env),
        appUrl: ctx.deps.env.APP_URL,
        storage: ctx.deps.storage,
        systemStorage: ctx.deps.systemStorage,
      });
      const user = await createUser(ctx.prisma, "<b>Ana</b>");
      await ctx.deps.jobs.enqueue("email-send", { kind: "password-changed", userId: user.id });
      const message = await waitForEmail(user.email);
      expect(message?.Subject).toBe("Tu contraseña de SpiderFolio cambió");
      const detail = (await (
        await fetch(`${MAILPIT_API}/message/${message?.ID ?? ""}`)
      ).json()) as {
        HTML: string;
        Text: string;
      };
      expect(detail.HTML).toContain("&lt;b&gt;Ana&lt;/b&gt;");
      expect(detail.Text).toContain("Cambiaste tu contraseña");

      const schedules = await worker.getSchedules();
      expect(schedules).toContainEqual(
        expect.objectContaining({
          name: "maintenance-cleanup",
          cron: "15 * * * *",
          timezone: "UTC",
        }),
      );
    } finally {
      await worker.stop({ graceful: false });
    }
  });
});

describe("rendimiento y aislamiento de fallos del worker", () => {
  it("procesa una tanda en segundos y un email que falla no reintenta a los demás", async () => {
    const sent: string[] = [];
    const users = await Promise.all(
      Array.from({ length: 15 }, (_, i) => createUser(ctx.prisma, `Tanda ${String(i)}`)),
    );
    const failing = users[0];
    if (failing === undefined) throw new Error("sin usuarios");
    const worker = createTestBoss(ctx.deps.env.DATABASE_URL, "worker");
    await worker.start();
    try {
      await startWorker(worker, {
        prisma: ctx.prisma,
        logger: createLogger(ctx.deps.env),
        appUrl: ctx.deps.env.APP_URL,
        storage: ctx.deps.storage,
        systemStorage: ctx.deps.systemStorage,
        mailer: {
          send: (message) => {
            if (message.to === failing.email) return Promise.reject(new Error("SMTP caído"));
            sent.push(message.to);
            return Promise.resolve();
          },
        },
      });
      const start = Date.now();
      for (const user of users) {
        await ctx.deps.jobs.enqueue("email-send", { kind: "password-changed", userId: user.id });
      }
      await expect.poll(() => sent.length, { timeout: 10_000 }).toBe(14);
      expect(Date.now() - start).toBeLessThan(10_000);
      // Cada email una sola vez: el fallo de uno no hizo reenviar el resto del lote.
      expect(new Set(sent).size).toBe(14);
      const rows = await ctx.prisma.$queryRawUnsafe<{ state: string; retry_count: number }[]>(
        `SELECT state, retry_count FROM pgboss.job WHERE name = 'email-send' AND data->>'userId' = $1`,
        failing.id,
      );
      expect(rows[0]?.state).toMatch(/retry|failed/);
    } finally {
      await worker.stop({ graceful: false });
    }
  });
});

describe("limpieza de vencidos", () => {
  it("borra sesiones y tokens vencidos y deja los vigentes", async () => {
    const user = await createUser(ctx.prisma);
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 3600_000);
    await ctx.prisma.session.createMany({
      data: [
        {
          userId: user.id,
          familyId: "f",
          familyCreatedAt: past,
          tokenHash: `a-${user.id}`,
          expiresAt: past,
        },
        {
          userId: user.id,
          familyId: "f",
          familyCreatedAt: past,
          tokenHash: `b-${user.id}`,
          expiresAt: future,
        },
      ],
    });
    await ctx.prisma.authToken.createMany({
      data: [
        { userId: user.id, type: "VERIFY_EMAIL", tokenHash: `c-${user.id}`, expiresAt: past },
        { userId: user.id, type: "VERIFY_EMAIL", tokenHash: `d-${user.id}`, expiresAt: future },
      ],
    });
    await cleanupExpired(ctx.deps, {});
    expect(await ctx.prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await ctx.prisma.authToken.count({ where: { userId: user.id } })).toBe(1);
  });
});
