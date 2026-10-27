// 2FA, paso 5: reinicio de la 2FA de un miembro por un administrador (con su propia 2FA activa y
// confirmada hace poco, mismo alcance que el resto de acciones sobre miembros, auditoría y aviso por
// email) y confirmación reciente para cambiar el email.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { errorOf } from "../http.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const reset = (token: string, slug: string, memberId: string) =>
  request(app)
    .post(`/api/v1/w/${slug}/admin/members/${memberId}/2fa/reset`)
    .set("Authorization", `Bearer ${token}`);

async function giveTwoFactor(userId: string) {
  await ctx.prisma.user.update({
    where: { id: userId },
    data: { totpEnabledAt: new Date(), totpSecretEnc: "k1:x:y:z" },
  });
  await ctx.prisma.recoveryCode.create({ data: { userId, codeHash: `h-${userId}` } });
  await ctx.prisma.trustedDevice.create({
    data: { userId, tokenHash: `d-${userId}`, expiresAt: new Date(Date.now() + 86_400_000) },
  });
}
const confirmedNow = (userId: string) =>
  ctx.prisma.session.updateMany({ where: { userId }, data: { mfaAt: new Date() } });

async function world(label: string) {
  const ws = await createWorkspace(ctx, label);
  const target = await addMember(ctx, ws, { name: "Perdió el teléfono" });
  await giveTwoFactor(target.user.id);
  return { ws, target };
}

describe("reiniciar la 2FA de un miembro", () => {
  it("borra secreto, códigos y dispositivos, cierra sus sesiones, audita y avisa", async () => {
    const { ws, target } = await world("Reinicio 2FA");
    await giveTwoFactor(ws.owner.id);
    await confirmedNow(ws.owner.id);
    const res = await reset(ws.token, ws.slug, target.membership.id);
    expect(res.status).toBe(204);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(user.totpEnabledAt).toBeNull();
    expect(user.totpSecretEnc).toBeNull();
    expect(await ctx.prisma.recoveryCode.count({ where: { userId: target.user.id } })).toBe(0);
    expect(await ctx.prisma.trustedDevice.count({ where: { userId: target.user.id } })).toBe(0);
    expect(
      await ctx.prisma.session.count({ where: { userId: target.user.id, revokedAt: null } }),
    ).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          workspaceId: ws.workspaceId,
          action: "member.2fa.reset",
          entityId: target.membership.id,
        },
      }),
    ).toBe(1);
    const jobs = await ctx.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pgboss.job
      WHERE name = 'email-send' AND data->>'kind' = 'mfa-reset' AND data->>'userId' = ${target.user.id}`;
    expect(Number(jobs[0]?.count ?? 0)).toBe(1);
  });

  it("solo un administrador con su 2FA activa y confirmada hace poco", async () => {
    const { ws, target } = await world("Reinicio 2FA requisitos");
    const without = await reset(ws.token, ws.slug, target.membership.id);
    expect(without.status).toBe(403);
    expect(errorOf(without).code).toBe("FORBIDDEN");
    await giveTwoFactor(ws.owner.id);
    await ctx.prisma.session.updateMany({
      where: { userId: ws.owner.id },
      data: { mfaAt: new Date(Date.now() - 11 * 60_000) },
    });
    const stale = await reset(ws.token, ws.slug, target.membership.id);
    expect(stale.status).toBe(403);
    expect(errorOf(stale).code).toBe("MFA_RECENT_REQUIRED");
    // La persona sigue con su 2FA.
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: target.user.id } })).totpEnabledAt,
    ).not.toBeNull();
  });

  it("respeta capacidades y rango: un miembro no puede, un admin no reinicia al propietario", async () => {
    const { ws, target } = await world("Reinicio 2FA rango");
    const member = await addMember(ctx, ws);
    await giveTwoFactor(member.user.id);
    await confirmedNow(member.user.id);
    expect((await reset(member.token, ws.slug, target.membership.id)).status).toBe(403);

    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    await giveTwoFactor(admin.user.id);
    await confirmedNow(admin.user.id);
    await giveTwoFactor(ws.owner.id);
    const ownerMembership = await ctx.prisma.membership.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, userId: ws.owner.id },
    });
    expect((await reset(admin.token, ws.slug, ownerMembership.id)).status).toBe(403);
    expect((await reset(admin.token, ws.slug, target.membership.id)).status).toBe(204);
  });

  it("no sirve para uno mismo ni para miembros de otra empresa", async () => {
    const { ws } = await world("Reinicio 2FA propio");
    const other = await world("Reinicio 2FA ajena");
    await giveTwoFactor(ws.owner.id);
    await confirmedNow(ws.owner.id);
    const self = await ctx.prisma.membership.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, userId: ws.owner.id },
    });
    expect((await reset(ws.token, ws.slug, self.id)).status).toBe(400);
    expect((await reset(ws.token, ws.slug, other.target.membership.id)).status).toBe(404);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: other.target.user.id } }))
        .totpEnabledAt,
    ).not.toBeNull();
  });
});

describe("cambiar el email con 2FA", () => {
  it("pide la confirmación reciente", async () => {
    const ws = await createWorkspace(ctx, "Email con 2FA");
    await giveTwoFactor(ws.owner.id);
    await ctx.prisma.session.updateMany({
      where: { userId: ws.owner.id },
      data: { mfaAt: new Date(Date.now() - 11 * 60_000) },
    });
    const res = await request(app)
      .post("/api/v1/auth/change-email")
      .set("Authorization", `Bearer ${ws.token}`)
      .send({ email: "nuevo-2fa@test.local", currentPassword: "lo-que-sea-1234" });
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe("MFA_RECENT_REQUIRED");
  });
});
