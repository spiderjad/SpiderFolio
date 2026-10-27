// «Los jefes pueden invitar»: lo que invita una jefa o subjefa (sin rol de administración) les llega
// a la campana de quienes administran los miembros (propietario y members.manage), con quién invitó,
// a quién y a qué departamento. Nadie más lo recibe, y lo que invita un administrador no avisa.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
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

const api = (slug: string, token: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  put: (path: string, body?: object) =>
    request(app)
      .put(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
});

interface Notifications {
  items: {
    kind: string;
    actor: { name: string } | null;
    invitation: { email: string; departments: string[] } | null;
  }[];
}

let n = 0;
const email = () => `jefa-invita-${String((n += 1))}-${String(Date.now())}@test.local`;

async function world(label: string) {
  const ws = await createWorkspace(ctx, label);
  const owner = api(ws.slug, ws.token);
  const calidad = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Calidad" },
  });
  const admin = await addMember(ctx, ws, { base: "ADMIN", name: "Adela Admin" });
  const boss = await addMember(ctx, ws, { name: "Jefa Calidad" });
  const ana = await addMember(ctx, ws, { name: "Ana Calidad" });
  await ctx.prisma.departmentMember.createMany({
    data: [boss, ana].map((p) => ({
      workspaceId: ws.workspaceId,
      departmentId: calidad.id,
      membershipId: p.membership.id,
    })),
  });
  const placed = await owner.put(
    `/admin/departments/${calidad.id}/members/${boss.membership.id}/position`,
    { position: "HEAD" },
  );
  expect(placed.status).toBe(200);
  await ctx.prisma.user.updateMany({
    where: { memberships: { some: { workspaceId: ws.workspaceId } } },
    data: { emailVerifiedAt: new Date() },
  });
  const memberRole = await ctx.prisma.role.findFirstOrThrow({
    where: { workspaceId: ws.workspaceId, base: "MEMBER", isSystem: true },
  });
  const ownerMembership = await ctx.prisma.membership.findFirstOrThrow({
    where: { workspaceId: ws.workspaceId, role: { base: "OWNER" } },
  });
  return { ws, owner, calidad, admin, boss, ana, memberRole, ownerMembership };
}

const noticesOf = (membershipId: string) =>
  ctx.prisma.notification.count({ where: { membershipId, kind: "invitation_by_leader" } });

describe("avisos de invitaciones hechas por un jefe", () => {
  it("la jefa invita: avisan al propietario y al administrador; ni a ella ni a un miembro", async () => {
    const w = await world("Aviso invitación jefa");
    const other = await world("Aviso invitación otra empresa");
    const invited = email();
    const res = await api(w.ws.slug, w.boss.token).post("/admin/invitations", {
      emails: [invited],
      roleId: w.memberRole.id,
      departmentIds: [w.calidad.id],
    });
    expect(res.status).toBe(201);

    expect(await noticesOf(w.ownerMembership.id)).toBe(1);
    expect(await noticesOf(w.admin.membership.id)).toBe(1);
    expect(await noticesOf(w.boss.membership.id)).toBe(0);
    expect(await noticesOf(w.ana.membership.id)).toBe(0);
    // La otra empresa no recibe nada.
    expect(
      await ctx.prisma.notification.count({
        where: { workspaceId: other.ws.workspaceId, kind: "invitation_by_leader" },
      }),
    ).toBe(0);

    // En la campana: quién invitó, a quién y a qué departamento.
    const bell = await api(w.ws.slug, w.admin.token).get("/notifications");
    expect(bell.status).toBe(200);
    const item = (bell.body as Notifications).items.find(
      (row) => row.kind === "invitation_by_leader",
    );
    expect(item?.actor?.name).toBe("Jefa Calidad");
    expect(item?.invitation).toEqual({ email: invited, departments: ["Calidad"] });

    // La jefa y el miembro no lo ven en su campana.
    for (const who of [w.boss, w.ana]) {
      const own = await api(w.ws.slug, who.token).get("/notifications");
      expect(
        (own.body as Notifications).items.filter((row) => row.kind === "invitation_by_leader"),
      ).toEqual([]);
    }
  });

  it("lo que invita un administrador no genera avisos", async () => {
    const w = await world("Aviso invitación admin");
    const res = await api(w.ws.slug, w.admin.token).post("/admin/invitations", {
      emails: [email()],
      roleId: w.memberRole.id,
      departmentIds: [w.calidad.id],
    });
    expect(res.status).toBe(201);
    expect(
      await ctx.prisma.notification.count({
        where: { workspaceId: w.ws.workspaceId, kind: "invitation_by_leader" },
      }),
    ).toBe(0);
  });
});
