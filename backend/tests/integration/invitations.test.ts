// Parte 4 del Módulo 2: plazas, invitaciones y aceptación.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { sendEmailJob } from "../../src/jobs/handlers.ts";
import { createMailer } from "../../src/lib/mailer.ts";
import {
  addMember,
  createTestContext,
  createUser,
  createWorkspace,
  tokenFromEmail,
  uniqueEmail,
  waitForEmail,
  type TestContext,
  type TestWorkspace,
  testPluginRuntime,
} from "./helpers.ts";
import { errorOf } from "../http.ts";
import { defineBackendPlugin } from "@spiderfolio/plugin-sdk/backend";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const api = (slug: string, token: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  delete: (path: string) =>
    request(app).delete(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
});

/** Workspace con el dueño ya con el email verificado (sin eso no se puede invitar). */
async function verifiedWorkspace(name: string): Promise<TestWorkspace> {
  const ws = await createWorkspace(ctx, name);
  await ctx.prisma.user.update({
    where: { id: ws.owner.id },
    data: { emailVerifiedAt: new Date() },
  });
  return ws;
}

async function roleId(ws: TestWorkspace, base: "ADMIN" | "MEMBER" | "GUEST" | "OWNER") {
  return (
    await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: ws.workspaceId,
        base,
        isSystem: true,
      },
    })
  ).id;
}

interface InvitationBody {
  id: string;
  email: string;
  seatType: string;
  roleName: string;
  status: string;
}
const created = (res: { body: unknown }) =>
  res.body as { invitations: InvitationBody[]; skipped: { email: string; reason: string }[] };

/** Procesa el job de email como lo haría el worker y devuelve el token del enlace. */
async function deliver(invitationId: string, to: string): Promise<string> {
  const mailer = createMailer(ctx.deps.env);
  await sendEmailJob(
    {
      prisma: ctx.prisma,
      mailer,
      logger: ctx.deps.logger,
      appUrl: ctx.deps.env.APP_URL,
      storage: ctx.deps.storage,
      systemStorage: ctx.deps.systemStorage,
    },
    { kind: "invitation", invitationId },
  );
  const mail = await waitForEmail(to);
  return tokenFromEmail(mail.text);
}

async function jobsFor(invitationId: string): Promise<number> {
  const rows = await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM pgboss.job WHERE name = 'email-send' AND data->>'invitationId' = $1`,
    invitationId,
  );
  return Number(rows[0]?.n ?? 0);
}

describe("invitar", () => {
  it("exige el email verificado de quien invita", async () => {
    const ws = await createWorkspace(ctx, "Invitar sin verificar");
    const res = await api(ws.slug, ws.token).post("/admin/invitations", {
      emails: [uniqueEmail()],
      roleId: await roleId(ws, "MEMBER"),
    });
    expect(res.status).toBe(403);
    expect(errorOf(res).message).toContain("Confirma tu email");
  });

  it("crea invitaciones pendientes, encola el email y ocupan plaza", async () => {
    const ws = await verifiedWorkspace("Invitar plazas");
    const a = api(ws.slug, ws.token);
    const emails = [uniqueEmail("ana"), uniqueEmail("luis")];
    const res = await a.post("/admin/invitations", {
      emails: [emails[0], (emails[1] ?? "").toUpperCase()],
      roleId: await roleId(ws, "MEMBER"),
    });
    expect(res.status).toBe(201);
    const body = created(res);
    expect(body.invitations.map((i) => i.email).sort()).toEqual([...emails].sort());
    expect(body.invitations.every((i) => i.seatType === "FULL" && i.status === "pending")).toBe(
      true,
    );
    for (const invitation of body.invitations) expect(await jobsFor(invitation.id)).toBe(1);

    // El dueño + 2 invitaciones pendientes = 3 plazas completas usadas.
    const seats = (await a.get("/admin/seats")).body as {
      seats: { FULL: { used: number }; READER: { used: number } };
    };
    expect(seats.seats.FULL.used).toBe(3);
    expect(seats.seats.READER.used).toBe(0);

    const list = (await a.get("/admin/invitations")).body as { items: InvitationBody[] };
    expect(list.items).toHaveLength(2);
    // En la base solo hay hashes.
    const rows = await ctx.prisma.invitation.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
    const actions = await ctx.prisma.auditLog.count({
      where: { workspaceId: ws.workspaceId, action: "invitation.create" },
    });
    expect(actions).toBe(2);
  });

  it("omite a quien ya es miembro o ya tiene una invitación pendiente", async () => {
    const ws = await verifiedWorkspace("Invitar duplicados");
    const a = api(ws.slug, ws.token);
    const member = await addMember(ctx, ws, { name: "Ya miembro" });
    const pending = uniqueEmail("pendiente");
    const role = await roleId(ws, "MEMBER");
    await a.post("/admin/invitations", { emails: [pending], roleId: role });
    const res = await a.post("/admin/invitations", {
      emails: [member.user.email, pending, uniqueEmail("nueva")],
      roleId: role,
    });
    expect(res.status).toBe(201);
    const body = created(res);
    expect(body.invitations).toHaveLength(1);
    expect(body.skipped.sort((x, y) => x.reason.localeCompare(y.reason))).toEqual(
      [
        { email: member.user.email, reason: "member" },
        { email: pending, reason: "pending" },
      ].sort((x, y) => x.reason.localeCompare(y.reason)),
    );
    // Si todas se omiten, 200 y nada creado.
    const none = await a.post("/admin/invitations", { emails: [pending], roleId: role });
    expect(none.status).toBe(200);
    expect(created(none).invitations).toEqual([]);
  });

  it("no hay límite de plazas: invita a varios de una vez", async () => {
    const ws = await verifiedWorkspace("Invitar sin límite");
    const a = api(ws.slug, ws.token);
    const role = await roleId(ws, "MEMBER");
    const many = await a.post("/admin/invitations", {
      emails: [uniqueEmail(), uniqueEmail(), uniqueEmail()],
      roleId: role,
    });
    expect(many.status).toBe(201);
    expect(created(many).invitations).toHaveLength(3);
  });

  it("un invitado externo es lector, sin departamentos ni plaza completa", async () => {
    const ws = await verifiedWorkspace("Invitar invitados");
    const a = api(ws.slug, ws.token);
    const guest = await roleId(ws, "GUEST");
    const res = await a.post("/admin/invitations", { emails: [uniqueEmail()], roleId: guest });
    expect(res.status).toBe(201);
    expect(created(res).invitations[0]?.seatType).toBe("READER");
    const full = await a.post("/admin/invitations", {
      emails: [uniqueEmail()],
      roleId: guest,
      seatType: "FULL",
    });
    expect(full.status).toBe(400);
    const department = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    const withDepartment = await a.post("/admin/invitations", {
      emails: [uniqueEmail()],
      roleId: guest,
      departmentIds: [department.id],
    });
    expect(withDepartment.status).toBe(400);
  });

  it("rechaza el rol de propietario, lectores con roles administrativos y la escalada", async () => {
    const ws = await verifiedWorkspace("Invitar roles");
    const a = api(ws.slug, ws.token);
    expect(
      (
        await a.post("/admin/invitations", {
          emails: [uniqueEmail()],
          roleId: await roleId(ws, "OWNER"),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await a.post("/admin/invitations", {
          emails: [uniqueEmail()],
          roleId: await roleId(ws, "ADMIN"),
          seatType: "READER",
        })
      ).status,
    ).toBe(400);
    // Quien invita sin gestionar la seguridad no invita con un rol que la da.
    const seguridad = await ctx.prisma.role.create({
      data: {
        workspaceId: ws.workspaceId,
        name: "Seguridad",
        base: "MEMBER",
        capabilities: ["security.manage"],
      },
    });
    const inviter = await ctx.prisma.role.create({
      data: {
        workspaceId: ws.workspaceId,
        name: "Invita",
        base: "ADMIN",
        capabilities: ["members.view", "members.invite"],
      },
    });
    const admin = await addMember(ctx, ws, { roleId: inviter.id });
    await ctx.prisma.user.update({
      where: { id: admin.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    const res = await api(ws.slug, admin.token).post("/admin/invitations", {
      emails: [uniqueEmail()],
      roleId: seguridad.id,
    });
    expect(res.status).toBe(403);
  });

  it("respeta las reglas de email de un plugin activo, salvo para invitados externos", async () => {
    const ws = await verifiedWorkspace("Invitar dominios");
    // Un plugin de prueba que solo admite @empresa.com (como Políticas de seguridad avanzadas).
    const domains = defineBackendPlugin({
      id: "test-domains",
      version: "0.0.0",
      hooks: {
        checkMemberEmail: (_ctx, email) =>
          Promise.resolve(email.endsWith("@empresa.com") ? null : "Dominio no permitido"),
      },
    });
    const pluginApp = createApp({
      ...ctx.deps,
      plugins: await testPluginRuntime(ctx, [domains], [ws.workspaceId]),
    });
    const a = {
      post: (path: string, body: object) =>
        request(pluginApp)
          .post(`/api/v1/w/${ws.slug}${path}`)
          .set("Authorization", `Bearer ${ws.token}`)
          .send(body),
    };
    const role = await roleId(ws, "MEMBER");
    const bad = await a.post("/admin/invitations", {
      emails: ["ana@empresa.com", "luis@gmail.com"],
      roleId: role,
    });
    expect(bad.status).toBe(400);
    expect(errorOf(bad).code).toBe("VALIDATION_ERROR");
    expect(errorOf(bad).details).toEqual({
      issues: [
        { path: "emails.1", code: "domain_not_allowed", message: expect.any(String) as string },
      ],
    });
    expect(
      (await a.post("/admin/invitations", { emails: ["ana@empresa.com"], roleId: role })).status,
    ).toBe(201);
    expect(
      (
        await a.post("/admin/invitations", {
          emails: ["externo@gmail.com"],
          roleId: await roleId(ws, "GUEST"),
        })
      ).status,
    ).toBe(201);
  });

  it("revoca (libera la plaza) y reenvía con enlace nuevo", async () => {
    const ws = await verifiedWorkspace("Invitar revocar");
    const a = api(ws.slug, ws.token);
    const email = uniqueEmail("reenvio");
    const first = created(
      await a.post("/admin/invitations", { emails: [email], roleId: await roleId(ws, "MEMBER") }),
    ).invitations[0] as InvitationBody;

    const oldToken = await deliver(first.id, email);
    const resend = await a.post(`/admin/invitations/${first.id}/resend`);
    expect(resend.status).toBe(200);
    expect(await jobsFor(first.id)).toBe(2);
    const newToken = await deliver(first.id, email);
    expect(newToken).not.toBe(oldToken);
    // El enlace anterior ya no sirve; el nuevo sí.
    expect((await request(app).get(`/api/v1/auth/invitations/${oldToken}`)).status).toBe(400);
    expect((await request(app).get(`/api/v1/auth/invitations/${newToken}`)).status).toBe(200);

    expect((await a.delete(`/admin/invitations/${first.id}`)).status).toBe(204);
    const seats = (await a.get("/admin/seats")).body as { seats: { FULL: { used: number } } };
    expect(seats.seats.FULL.used).toBe(1);
    expect((await a.delete(`/admin/invitations/${first.id}`)).status).toBe(404);
    expect((await a.post(`/admin/invitations/${first.id}/resend`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/auth/invitations/${newToken}`)).status).toBe(400);
  });

  it("exige members.invite", async () => {
    const ws = await verifiedWorkspace("Invitar permisos");
    const member = await addMember(ctx, ws);
    const m = api(ws.slug, member.token);
    const body = { emails: [uniqueEmail()], roleId: await roleId(ws, "MEMBER") };
    expect((await m.post("/admin/invitations", body)).status).toBe(403);
    expect((await m.get("/admin/invitations")).status).toBe(403);
    expect((await m.get("/admin/seats")).status).toBe(403);
  });
});

describe("aceptar una invitación", () => {
  it("sin aceptar los términos no se crea la cuenta y la invitación sigue pendiente", async () => {
    const ws = await verifiedWorkspace("Aceptar sin términos");
    const a = api(ws.slug, ws.token);
    const email = uniqueEmail("sinterminos");
    const invitation = created(
      await a.post("/admin/invitations", {
        emails: [email],
        roleId: await roleId(ws, "MEMBER"),
        departmentIds: [],
      }),
    ).invitations[0] as InvitationBody;
    const token = await deliver(invitation.id, email);

    for (const extra of [{}, { acceptTerms: false }]) {
      const res = await request(app)
        .post(`/api/v1/auth/invitations/${token}/accept`)
        .send({ name: "Ana Nueva", password: "una-clave-bien-larga", ...extra });
      expect(res.status).toBe(400);
    }
    expect(await ctx.prisma.user.count({ where: { email } })).toBe(0);

    const ok = await request(app).post(`/api/v1/auth/invitations/${token}/accept`).send({
      name: "Ana Nueva",
      password: "una-clave-bien-larga",
      acceptTerms: true,
      marketingOptIn: true,
    });
    expect(ok.status).toBe(201);
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email },
      include: { termsAcceptances: true },
    });
    expect(user.termsAcceptances).toHaveLength(1);
    expect(user.termsAcceptances[0]?.version).toBe(ctx.deps.env.TERMS_VERSION);
    expect(user.marketingOptIn).toBe(true);
  });

  it("crea la cuenta con el email verificado, la membresía, los departamentos y la sesión", async () => {
    const ws = await verifiedWorkspace("Aceptar nueva cuenta");
    const a = api(ws.slug, ws.token);
    const department = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    const email = uniqueEmail("nueva");
    const invitation = created(
      await a.post("/admin/invitations", {
        emails: [email],
        roleId: await roleId(ws, "MEMBER"),
        departmentIds: [department.id],
      }),
    ).invitations[0] as InvitationBody;
    const token = await deliver(invitation.id, email);

    const preview = await request(app).get(`/api/v1/auth/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      email,
      workspaceName: "Aceptar nueva cuenta",
      roleName: "Miembro",
      hasAccount: false,
    });

    const missing = await request(app).post(`/api/v1/auth/invitations/${token}/accept`).send({});
    expect(missing.status).toBe(400);

    const accepted = await request(app)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .send({ name: "Ana Nueva", password: "una-clave-bien-larga", acceptTerms: true });
    expect(accepted.status).toBe(201);
    const body = accepted.body as {
      accessToken: string;
      workspaceSlug: string;
      user: { email: string; emailVerified: boolean };
      memberships: { workspace: { slug: string }; departments: { id: string; name: string }[] }[];
    };
    expect(body.workspaceSlug).toBe(ws.slug);
    expect(body.user).toMatchObject({ email, emailVerified: true });
    expect(body.memberships[0]?.departments).toEqual([
      { position: "MEMBER", id: department.id, name: "Calidad" },
    ]);
    expect(accepted.headers["set-cookie"]?.toString()).toContain("spiderfolio_rt=");

    // Ya está en el workspace y la invitación no se puede reutilizar.
    const me = await request(app)
      .get(`/api/v1/w/${ws.slug}`)
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
    const again = await request(app)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .send({ name: "Otra", password: "una-clave-bien-larga", acceptTerms: true });
    expect(again.status).toBe(400);
    expect(errorOf(again).code).toBe("INVALID_TOKEN");
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "invitation.accept" },
      }),
    ).toBe(1);
  });

  it("con una cuenta existente exige iniciar sesión con esa cuenta", async () => {
    const ws = await verifiedWorkspace("Aceptar cuenta existente");
    const a = api(ws.slug, ws.token);
    const user = await createUser(ctx.prisma, "Ya tengo cuenta");
    const invitation = created(
      await a.post("/admin/invitations", {
        emails: [user.email],
        roleId: await roleId(ws, "MEMBER"),
      }),
    ).invitations[0] as InvitationBody;
    const token = await deliver(invitation.id, user.email);
    expect((await request(app).get(`/api/v1/auth/invitations/${token}`)).body).toMatchObject({
      hasAccount: true,
    });

    // Sin sesión: pide iniciar sesión.
    const anonymous = await request(app).post(`/api/v1/auth/invitations/${token}/accept`).send({});
    expect(anonymous.status).toBe(409);
    // Con la sesión de otra persona: no.
    const other = await createWorkspace(ctx, "Otra persona");
    const wrong = await request(app)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({});
    expect(wrong.status).toBe(403);
    // Con la suya: entra.
    const { loginAs } = await import("./helpers.ts");
    const own = await loginAs(ctx, user.id);
    const ok = await request(app)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .set("Authorization", `Bearer ${own}`)
      .send({});
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ workspaceSlug: ws.slug });
    expect(
      await ctx.prisma.membership.count({
        where: { userId: user.id, workspaceId: ws.workspaceId },
      }),
    ).toBe(1);
  });

  it("una invitación vencida, revocada o inventada es INVALID_TOKEN", async () => {
    const ws = await verifiedWorkspace("Aceptar inválidas");
    const a = api(ws.slug, ws.token);
    const email = uniqueEmail("vencida");
    const invitation = created(
      await a.post("/admin/invitations", { emails: [email], roleId: await roleId(ws, "MEMBER") }),
    ).invitations[0] as InvitationBody;
    const token = await deliver(invitation.id, email);
    await ctx.prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    for (const t of [token, "x".repeat(43)]) {
      const get = await request(app).get(`/api/v1/auth/invitations/${t}`);
      expect(get.status).toBe(400);
      expect(errorOf(get).code).toBe("INVALID_TOKEN");
      const post = await request(app)
        .post(`/api/v1/auth/invitations/${t}/accept`)
        .send({ name: "Ana", password: "una-clave-bien-larga", acceptTerms: true });
      expect(post.status).toBe(400);
    }
    // Una vencida no ocupa plaza.
    const seats = (await a.get("/admin/seats")).body as { seats: { FULL: { used: number } } };
    expect(seats.seats.FULL.used).toBe(1);
  });
});
