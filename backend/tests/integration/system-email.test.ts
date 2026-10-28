// Server SMTP (.env): a permanent failure (credentials) isn't retried, it's marked as failed and only
// the owner and administrators of the affected company get the bell notice with the reason; a
// connection failure is still retried. The admin test sends with the server SMTP (Mailpit here) and
// is only for those who manage security.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { createLogger } from "../../src/lib/logger.ts";
import type { Mailer } from "../../src/lib/mailer.ts";
import {
  monitorSystemMailer,
  systemEmailStatus,
} from "../../src/modules/email-settings/system-email.ts";
import { startWorker } from "../../src/worker.ts";
import {
  addMember,
  createTestBoss,
  createTestContext,
  createWorkspace,
  waitForEmail,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const failingWith =
  (fields: Record<string, unknown>): Mailer["send"] =>
  () =>
    Promise.reject(Object.assign(new Error("SMTP"), fields));

async function withWorker(send: Mailer["send"], run: () => Promise<void>): Promise<void> {
  const worker = createTestBoss(ctx.deps.env.DATABASE_URL, "worker");
  await worker.start();
  try {
    await startWorker(worker, {
      prisma: ctx.prisma,
      logger: createLogger(ctx.deps.env),
      appUrl: ctx.deps.env.APP_URL,
      storage: ctx.deps.storage,
      systemStorage: ctx.deps.systemStorage,
      mailer: monitorSystemMailer({ send }, { prisma: ctx.prisma, logger: createLogger(ctx.deps.env) }),
    });
    await run();
  } finally {
    await worker.stop({ graceful: false });
  }
}

async function jobOf(userId: string) {
  const rows = await ctx.prisma.$queryRawUnsafe<{ state: string; retry_count: number }[]>(
    `SELECT state, retry_count FROM pgboss.job WHERE name = 'email-send' AND data->>'userId' = $1`,
    userId,
  );
  return rows[0];
}

const failingNotices = (membershipId: string) =>
  ctx.prisma.notification.findMany({ where: { membershipId, kind: "email_failing" } });

describe("SMTP del servidor con un error permanente", () => {
  it("no reintenta, marca el envío como fallido y avisa solo a propietario y administradores", async () => {
    const ws = await createWorkspace(ctx, "Email caído");
    const admin = await addMember(ctx, ws, { base: "ADMIN", name: "Admin" });
    const member = await addMember(ctx, ws, { base: "MEMBER", name: "Miembro" });
    const other = await createWorkspace(ctx, "Otra empresa");

    await withWorker(
      failingWith({ code: "EAUTH", responseCode: 535, response: "535 Authentication failed" }),
      async () => {
        await ctx.deps.jobs.enqueue("email-send", {
          kind: "password-changed",
          userId: member.user.id,
        });
        await expect.poll(async () => (await jobOf(member.user.id))?.state, { timeout: 15_000 }).toBe(
          "failed",
        );
        await expect
          .poll(async () => (await failingNotices(ws.membershipId)).length, { timeout: 15_000 })
          .toBe(1);
      },
    );

    // A single attempt: a retry wouldn't fix the credentials.
    expect((await jobOf(member.user.id))?.retry_count).toBe(0);
    const [ownerNotice] = await failingNotices(ws.membershipId);
    expect(ownerNotice?.detail).toBe("AUTH");
    expect(await failingNotices(admin.membership.id)).toHaveLength(1);
    expect(await failingNotices(member.membership.id)).toHaveLength(0);
    expect(await failingNotices(other.membershipId)).toHaveLength(0);
    expect(await systemEmailStatus(ctx.prisma)).toMatchObject({
      failing: true,
      lastErrorCode: "AUTH",
    });

    // The bell shows it to the owner with its reason code.
    const res = await request(app)
      .get(`/api/v1/w/${ws.slug}/notifications`)
      .set("Authorization", `Bearer ${ws.token}`);
    expect(res.status).toBe(200);
    expect((res.body as { items: { kind: string; detail: string | null }[] }).items).toContainEqual(
      expect.objectContaining({ kind: "email_failing", detail: "AUTH" }),
    );
  });

  it("un fallo de conexión sí se reintenta y todavía no avisa", async () => {
    const ws = await createWorkspace(ctx, "Email intermitente");
    const member = await addMember(ctx, ws, { base: "MEMBER" });

    await withWorker(failingWith({ code: "ECONNECTION" }), async () => {
      await ctx.deps.jobs.enqueue("email-send", { kind: "password-changed", userId: member.user.id });
      await expect.poll(async () => (await jobOf(member.user.id))?.state, { timeout: 15_000 }).toBe(
        "retry",
      );
    });
    expect(await failingNotices(ws.membershipId)).toHaveLength(0);
    expect((await systemEmailStatus(ctx.prisma)).lastErrorCode).toBe("CONNECTION");
  });
});

describe("prueba del SMTP del servidor", () => {
  it("envía a quien la pide, deja el estado en «funciona» y no muestra el usuario SMTP", async () => {
    const ws = await createWorkspace(ctx, "Prueba de email");
    const res = await request(app)
      .post(`/api/v1/w/${ws.slug}/admin/email/system/test`)
      .set("Authorization", `Bearer ${ws.token}`)
      .send({});
    expect(res.status).toBe(200);
    const body = res.body as {
      result: { ok: boolean };
      settings: { status: { failing: boolean }; host: string; from: string };
    };
    expect(body.result.ok).toBe(true);
    expect(body.settings.status.failing).toBe(false);
    expect(body.settings.host).toBe(ctx.deps.env.SMTP_HOST);
    expect(JSON.stringify(body)).not.toContain("smtpUser");
    await waitForEmail(ws.owner.email, "Prueba del email de SpiderFolio");
  });

  it("solo para quien administra la seguridad", async () => {
    const ws = await createWorkspace(ctx, "Prueba sin permiso");
    const member = await addMember(ctx, ws, { base: "MEMBER" });
    for (const call of [
      request(app).get(`/api/v1/w/${ws.slug}/admin/email/system`),
      request(app).post(`/api/v1/w/${ws.slug}/admin/email/system/test`).send({}),
    ]) {
      const res = await call.set("Authorization", `Bearer ${member.token}`);
      expect(res.status).toBe(403);
    }
  });
});
