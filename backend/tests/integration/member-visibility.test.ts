// Visibilidad y gestión de personas (docs/spec/personas.md): matriz rol × acción × opción de
// Seguridad, contra la API. Todo se decide en el servidor:
// - Rol = toda la empresa (propietario, administrador); cargo = su área y subáreas (jefe, subjefe).
// - Directorio: según rol y la opción "Los miembros ven"; lector e invitado, solo su perfil.
// - Email, plaza, estado, invitaciones: gestores; jefes, solo su área.
// - Cambios de rol, plaza, suspender y quitar: propietario y administradores.
// - Seguridad: solo el propietario.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";
import type { TestWorkspace } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const api = (ws: Pick<TestWorkspace, "slug">, token: string) => {
  const call = (method: "get" | "post" | "put" | "patch" | "delete", path: string, body?: object) =>
    request(app)
      [method](`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  return {
    get: (path: string) => call("get", path),
    post: (path: string, body?: object) => call("post", path, body),
    put: (path: string, body?: object) => call("put", path, body),
    patch: (path: string, body?: object) => call("patch", path, body),
    delete: (path: string) => call("delete", path),
  };
};

interface Paged<T> {
  items: T[];
  total: number;
}
interface Entry {
  id: string;
  name: string;
  jobTitle: string | null;
  departments: { name: string; position: string }[];
}
interface DirectoryBody extends Paged<Entry> {
  viewScope: string;
}
interface OrgBlock {
  department: { id: string; name: string };
  head: { name: string; management: { status: string; email: string | null } | null } | null;
  members: {
    items: { name: string; management: { status: string; email: string | null } | null }[];
  };
}
interface OrgBody {
  departments: Paged<OrgBlock>;
  unassigned: { members: { total: number } } | null;
}

/**
 * Calidad (con la subárea Laboratorio) y Compras. Personas: propietario, administrador, jefa y
 * subjefa de Calidad, Ana (Calidad), Lola (Laboratorio), Hugo (jefe de Compras), Luis (Compras),
 * Rita (lectora de Calidad), un invitado externo y "Gestor" (rol de miembro personalizado con
 * todas las capacidades de personas, pero sin cargo: no debe poder nada).
 */
async function setup(label: string) {
  // App nueva por escenario: el límite global (300/min por IP) es en memoria de cada app.
  app = createApp(ctx.deps);
  const ws = await createWorkspace(ctx, label);
  const owner = api(ws, ws.token);
  const calidad = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Calidad" },
  });
  const lab = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Laboratorio", parentId: calidad.id },
  });
  const compras = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Compras" },
  });
  const gestorRole = await ctx.prisma.role.create({
    data: {
      workspaceId: ws.workspaceId,
      name: "Gestor sin cargo",
      base: "MEMBER",
      capabilities: [
        "members.view",
        "members.invite",
        "members.manage",
        "members.suspend",
        "departments.manage",
        "security.manage",
      ],
    },
  });
  const admin = await addMember(ctx, ws, { base: "ADMIN", name: "Adela Admin" });
  const admin2 = await addMember(ctx, ws, { base: "ADMIN", name: "Alba Admin" });
  const boss = await addMember(ctx, ws, { name: "Jefa Calidad" });
  const deputy = await addMember(ctx, ws, { name: "Subjefa Calidad" });
  const ana = await addMember(ctx, ws, { name: "Ana Calidad" });
  const lola = await addMember(ctx, ws, { name: "Lola Laboratorio" });
  const hugo = await addMember(ctx, ws, { name: "Hugo Compras" });
  const luis = await addMember(ctx, ws, { name: "Luis Compras" });
  const rita = await addMember(ctx, ws, { name: "Rita Lectora", seatType: "READER" });
  const guest = await addMember(ctx, ws, { base: "GUEST", name: "Gabi Invitada" });
  const gestor = await addMember(ctx, ws, { roleId: gestorRole.id, name: "Gestor Sin Cargo" });
  const place = async (departmentId: string, ...people: { membership: { id: string } }[]) => {
    await ctx.prisma.departmentMember.createMany({
      data: people.map((p) => ({
        workspaceId: ws.workspaceId,
        departmentId,
        membershipId: p.membership.id,
      })),
    });
  };
  await place(calidad.id, boss, deputy, ana, rita);
  await place(lab.id, lola);
  await place(compras.id, hugo, luis);
  await ctx.prisma.membership.update({
    where: { id: ana.membership.id },
    data: { jobTitle: "Analista" },
  });
  const position = async (departmentId: string, who: { membership: { id: string } }, p: string) =>
    await owner.put(`/admin/departments/${departmentId}/members/${who.membership.id}/position`, {
      position: p,
    });
  expect((await position(calidad.id, boss, "HEAD")).status).toBe(200);
  expect((await position(calidad.id, deputy, "DEPUTY")).status).toBe(200);
  expect((await position(compras.id, hugo, "HEAD")).status).toBe(200);
  // Lector con cargo: no gana alcance (Calidad ya tiene jefa; Rita es subjefa solo de nombre).
  expect((await position(calidad.id, rita, "DEPUTY")).status).toBe(200);
  const memberRole = await ctx.prisma.role.findFirstOrThrow({
    where: {
      workspaceId: ws.workspaceId,
      base: "MEMBER",
      isSystem: true,
    },
  });
  // Invitar exige el email confirmado.
  await ctx.prisma.user.updateMany({
    where: { memberships: { some: { workspaceId: ws.workspaceId } } },
    data: { emailVerifiedAt: new Date() },
  });
  return {
    ws,
    owner,
    calidad,
    lab,
    compras,
    memberRole,
    admin,
    admin2,
    boss,
    deputy,
    ana,
    lola,
    hugo,
    luis,
    rita,
    guest,
    gestor,
  };
}
type World = Awaited<ReturnType<typeof setup>>;

const names = (page: { items: { name: string }[] }) => page.items.map((m) => m.name).sort();
const TOTAL = 12; // propietario + 11 personas

describe("gestión de personas: ver email, plaza y estado", () => {
  it("propietario y administrador, toda la empresa; jefe y subjefe, su área; el resto, nadie", async () => {
    const w = await setup("Matriz gestión ver");
    const expected: [string, string, number | null][] = [
      ["propietario", w.ws.token, TOTAL],
      ["admin", w.admin.token, TOTAL],
      ["jefa", w.boss.token, 5],
      ["subjefa", w.deputy.token, 5],
      ["miembro", w.ana.token, null],
      ["lectora con cargo", w.rita.token, null],
      ["invitado", w.guest.token, null],
      ["miembro con capacidades pero sin cargo", w.gestor.token, null],
    ];
    for (const [who, token, total] of expected) {
      const a = api(w.ws, token);
      for (const path of [
        "/admin/members",
        "/admin/members/summary",
        "/admin/members/export",
        `/admin/members/${w.ana.membership.id}`,
        "/admin/invitations",
      ]) {
        const res = await a.get(path);
        expect(res.status, `${who} ${path}`).toBe(total === null ? 403 : 200);
      }
      if (total !== null) {
        expect(((await a.get("/admin/members")).body as Paged<unknown>).total, who).toBe(total);
      }
    }
  });

  it("jefa y subjefa: su área y subáreas, nunca lo ajeno; plazas son de toda la empresa", async () => {
    const w = await setup("Matriz gestión jefe");
    for (const who of [w.boss, w.deputy]) {
      const a = api(w.ws, who.token);
      const list = (await a.get("/admin/members")).body as Paged<{ name: string }>;
      expect(names(list)).toEqual(
        ["Ana Calidad", "Jefa Calidad", "Lola Laboratorio", "Rita Lectora", "Subjefa Calidad"]
          .concat([])
          .sort(),
      );
      expect((await a.get(`/admin/members/${w.luis.membership.id}`)).status).toBe(404);
      expect(names((await a.get("/admin/members?q=luis")).body as Paged<{ name: string }>)).toEqual(
        [],
      );
      const csv = (await a.get("/admin/members/export")).body as { csv: string };
      expect(csv.csv).toContain("Ana Calidad");
      expect(csv.csv).not.toContain("Luis Compras");
      expect((await a.get("/admin/seats")).status).toBe(403);
      const departments = (await a.get("/admin/departments")).body as Paged<{ name: string }>;
      // Con "toda la empresa" ve todos los departamentos (los de otras áreas, solo lectura).
      expect(names(departments)).toEqual(["Calidad", "Compras", "Laboratorio"]);
    }
  });

  it("perder el cargo quita el alcance en la petición siguiente", async () => {
    const w = await setup("Matriz gestión pierde");
    const a = api(w.ws, w.boss.token);
    expect((await a.get("/admin/members")).status).toBe(200);
    await w.owner.patch(`/admin/departments/${w.calidad.id}`, { headId: null });
    expect((await a.get("/admin/members")).status).toBe(403);
  });

  it("un lector con cargo no gana alcance", async () => {
    const w = await setup("Matriz lector jefe");
    expect(
      (
        await w.owner.put(
          `/admin/departments/${w.calidad.id}/members/${w.rita.membership.id}/position`,
          { position: "DEPUTY" },
        )
      ).status,
    ).toBe(200);
    expect((await api(w.ws, w.rita.token).get("/admin/members")).status).toBe(403);
  });

  it("los suspendidos los ve solo quien los gestiona", async () => {
    const w = await setup("Matriz suspendidos");
    expect((await w.owner.post(`/admin/members/${w.ana.membership.id}/suspend`)).status).toBe(200);
    expect((await w.owner.post(`/admin/members/${w.luis.membership.id}/suspend`)).status).toBe(200);
    const status = (res: { body: unknown }, name: string) =>
      (res.body as OrgBody).departments.items
        .flatMap((b) => [b.head, ...b.members.items])
        .find((m) => m?.name === name)?.management?.status;
    // La jefa gestiona Calidad: ve a Ana marcada; Luis (Compras) ni aparece.
    const boss = await api(w.ws, w.boss.token).get("/admin/members/org-chart");
    expect(status(boss, "Ana Calidad")).toBe("SUSPENDED");
    expect(status(boss, "Luis Compras")).toBeUndefined();
    // Un miembro no ve suspendidos.
    const luisSeen = await api(w.ws, w.lola.token).get("/admin/members/org-chart");
    expect(JSON.stringify(luisSeen.body)).not.toContain("Ana Calidad");
    expect(JSON.stringify(luisSeen.body)).not.toContain("Luis Compras");
    // El propietario ve a ambos.
    const owner = await w.owner.get("/admin/members/org-chart");
    expect(status(owner, "Ana Calidad")).toBe("SUSPENDED");
    expect(status(owner, "Luis Compras")).toBe("SUSPENDED");
    // El directorio nunca los lista.
    const dir = (await w.owner.get("/directory")).body as DirectoryBody;
    expect(names(dir)).not.toContain("Ana Calidad");
  });
});

describe("organigrama", () => {
  const blocks = (b: OrgBody) => b.departments.items.map((x) => x.department.name).sort();

  it("propietario, admin, jefa y subjefa lo ven completo; el email solo de su alcance", async () => {
    const w = await setup("Matriz organigrama");
    for (const token of [w.ws.token, w.admin.token, w.boss.token, w.deputy.token]) {
      const org = (await api(w.ws, token).get("/admin/members/org-chart")).body as OrgBody;
      expect(blocks(org)).toEqual(["Calidad", "Compras"]);
    }
    const boss = (await api(w.ws, w.boss.token).get("/admin/members/org-chart")).body as OrgBody;
    const calidad = boss.departments.items.find((b) => b.department.name === "Calidad");
    const compras = boss.departments.items.find((b) => b.department.name === "Compras");
    // Gestión de Calidad: con email. Compras, ajeno: solo nombre y puesto.
    expect(calidad?.members.items.every((m) => m.management !== null)).toBe(true);
    expect(compras?.head?.management).toBeNull();
    expect(compras?.members.items.every((m) => m.management === null)).toBe(true);
    expect(JSON.stringify(compras)).not.toMatch(/@/);
    // Búsqueda: encuentra a quien está en otra rama (ve el organigrama completo).
    const hits = (await api(w.ws, w.boss.token).get("/admin/members/org-chart/search?q=luis"))
      .body as { hits: unknown[] };
    expect(hits.hits).toHaveLength(1);
  });

  it("los miembros lo ven según la opción; lectores e invitados, no", async () => {
    const w = await setup("Matriz organigrama miembro");
    const asLuis = async () =>
      (await api(w.ws, w.luis.token).get("/admin/members/org-chart")).body as OrgBody;
    expect(blocks(await asLuis())).toEqual(["Calidad", "Compras"]);
    expect(
      (await w.owner.patch("/admin/security", { memberVisibility: "department" })).status,
    ).toBe(200);
    const limited = await asLuis();
    expect(blocks(limited)).toEqual(["Compras"]);
    expect(limited.unassigned).toBeNull();
    expect(JSON.stringify(limited)).not.toMatch(/@/);
    for (const who of [w.rita, w.guest]) {
      const res = await api(w.ws, who.token).get("/admin/members/org-chart");
      expect(res.status).toBe(403);
    }
  });
});

describe("directorio", () => {
  const seen = async (w: World, token: string) =>
    (await api(w.ws, token).get("/directory")).body as DirectoryBody;

  it("por defecto toda la empresa; sin email ni último acceso", async () => {
    const w = await setup("Matriz directorio empresa");
    const page = await seen(w, w.luis.token);
    expect(page.viewScope).toBe("all");
    expect(page.total).toBe(TOTAL - 1); // sin el invitado externo
    const entry = page.items.find((e) => e.name === "Ana Calidad");
    expect(entry).toMatchObject({ name: "Ana Calidad", jobTitle: "Analista" });
    expect(Object.keys(entry ?? {}).sort()).toEqual(["departments", "id", "jobTitle", "name"]);
    expect(JSON.stringify(page)).not.toMatch(/email|lastSeenAt|@/);
  });

  it("lector e invitado ven solo su propio perfil, con cualquier opción", async () => {
    const w = await setup("Matriz directorio self");
    for (const visibility of ["company", "department"] as const) {
      await w.owner.patch("/admin/security", { memberVisibility: visibility });
      const rita = await seen(w, w.rita.token);
      expect(names(rita)).toEqual(["Rita Lectora"]);
      expect(rita.viewScope).toBe("self");
      expect(names(await seen(w, w.guest.token))).toEqual(["Gabi Invitada"]);
    }
  });

  it('con "solo su departamento": miembros ven su área y los jefes de las demás; gestores, todo', async () => {
    const w = await setup("Matriz directorio depto");
    await w.owner.patch("/admin/security", { memberVisibility: "department" });
    // Ana (Calidad): su departamento directo (no Laboratorio) más el jefe de Compras.
    const ana = names(await seen(w, w.ana.token));
    expect(ana).toEqual(
      ["Ana Calidad", "Hugo Compras", "Jefa Calidad", "Rita Lectora", "Subjefa Calidad"].sort(),
    );
    // Lola (Laboratorio): su área más los jefes de Calidad y Compras.
    expect(names(await seen(w, w.lola.token))).toEqual(
      ["Hugo Compras", "Jefa Calidad", "Lola Laboratorio"].sort(),
    );
    // Luis (Compras): su área más la jefa de Calidad (no la subjefa).
    expect(names(await seen(w, w.luis.token))).toEqual(
      ["Hugo Compras", "Jefa Calidad", "Luis Compras"].sort(),
    );
    // Propietario, administrador, jefa y subjefa: toda la empresa.
    for (const token of [w.ws.token, w.admin.token, w.boss.token, w.deputy.token]) {
      const page = await seen(w, token);
      expect(page.viewScope).toBe("all");
      expect(page.total).toBe(TOTAL - 1);
    }
    // Volver a toda la empresa.
    await w.owner.patch("/admin/security", { memberVisibility: "company" });
    expect((await seen(w, w.luis.token)).total).toBe(TOTAL - 1);
  });
});

describe("invitar", () => {
  const invite = (w: World, token: string, body: object) =>
    api(w.ws, token).post("/admin/invitations", body);
  let n = 0;
  const email = () => `invitada-${String((n += 1))}-${String(Date.now())}@test.local`;

  it("propietario y administrador, sin restricción", async () => {
    const w = await setup("Matriz invitar admin");
    const adminRole = await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: w.ws.workspaceId,
        base: "ADMIN",
        isSystem: true,
      },
    });
    for (const [token, roleId] of [
      [w.ws.token, adminRole.id],
      [w.admin.token, w.memberRole.id],
    ] as const) {
      const res = await invite(w, token, { emails: [email()], roleId, departmentIds: [] });
      expect(res.status).toBe(201);
    }
  });

  it("jefa y subjefa: solo Miembro o Lector, solo su área y subáreas; queda marcado y lo ven los admins", async () => {
    const w = await setup("Matriz invitar jefe");
    const adminRole = await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: w.ws.workspaceId,
        base: "ADMIN",
        isSystem: true,
      },
    });
    const guestRole = await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: w.ws.workspaceId,
        base: "GUEST",
        isSystem: true,
      },
    });
    for (const who of [w.boss, w.deputy]) {
      const ok = await invite(w, who.token, {
        emails: [email()],
        roleId: w.memberRole.id,
        departmentIds: [w.calidad.id, w.lab.id],
      });
      expect(ok.status).toBe(201);
      const reader = await invite(w, who.token, {
        emails: [email()],
        roleId: w.memberRole.id,
        seatType: "READER",
        departmentIds: [w.lab.id],
      });
      expect(reader.status).toBe(201);
      // Otro rol, otra área, sin área o un invitado externo: no.
      const bad: [string, object][] = [
        ["rol de administrador", { roleId: adminRole.id, departmentIds: [w.calidad.id] }],
        ["invitado externo", { roleId: guestRole.id, departmentIds: [w.calidad.id] }],
        ["otra área", { roleId: w.memberRole.id, departmentIds: [w.compras.id] }],
        ["sin área", { roleId: w.memberRole.id, departmentIds: [] }],
        [
          "una propia y una ajena",
          { roleId: w.memberRole.id, departmentIds: [w.calidad.id, w.compras.id] },
        ],
      ];
      for (const [what, extra] of bad) {
        const res = await invite(w, who.token, { emails: [email()], ...extra });
        expect(res.status, what).toBeGreaterThanOrEqual(400);
        expect(res.status, what).toBeLessThan(500);
      }
    }
    const events = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: w.ws.workspaceId, action: "invitation.create" },
    });
    expect(
      events.filter((e) => (e.metadata as { byLeader?: boolean }).byLeader === true),
    ).toHaveLength(4);
    // Los administradores la ven en pendientes y pueden revocarla; la jefa solo ve su área.
    const pending = (await api(w.ws, w.admin.token).get("/admin/invitations")).body as Paged<{
      id: string;
    }>;
    expect(pending.total).toBe(4);
    const own = (await api(w.ws, w.boss.token).get("/admin/invitations")).body as Paged<unknown>;
    expect(own.total).toBe(4);
    const compras = await invite(w, w.admin.token, {
      emails: [email()],
      roleId: w.memberRole.id,
      departmentIds: [w.compras.id],
    });
    expect(compras.status).toBe(201);
    expect(
      ((await api(w.ws, w.boss.token).get("/admin/invitations")).body as Paged<unknown>).total,
    ).toBe(4);
    const first = pending.items[0];
    expect(first).toBeDefined();
    expect(
      (await api(w.ws, w.boss.token).delete(`/admin/invitations/${first?.id ?? ""}`)).status,
    ).toBe(403);
    expect(
      (await api(w.ws, w.admin.token).delete(`/admin/invitations/${first?.id ?? ""}`)).status,
    ).toBe(204);
  });

  it('la opción "Los jefes pueden invitar a su área" lo apaga', async () => {
    const w = await setup("Matriz invitar opción");
    expect((await w.owner.patch("/admin/security", { leadersCanInvite: false })).status).toBe(200);
    const res = await invite(w, w.boss.token, {
      emails: [email()],
      roleId: w.memberRole.id,
      departmentIds: [w.calidad.id],
    });
    expect(res.status).toBe(403);
    // Propietario y administradores no dependen de la opción.
    expect(
      (await invite(w, w.admin.token, { emails: [email()], roleId: w.memberRole.id })).status,
    ).toBe(201);
    await w.owner.patch("/admin/security", { leadersCanInvite: true });
    expect(
      (
        await invite(w, w.boss.token, {
          emails: [email()],
          roleId: w.memberRole.id,
          departmentIds: [w.calidad.id],
        })
      ).status,
    ).toBe(201);
  });

  it("miembros, lectores, invitados y miembros con capacidades pero sin cargo no invitan", async () => {
    const w = await setup("Matriz invitar nadie");
    for (const who of [w.ana, w.rita, w.guest, w.gestor]) {
      const res = await invite(w, who.token, {
        emails: [email()],
        roleId: w.memberRole.id,
        departmentIds: [w.calidad.id],
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("cambiar rol, plaza, estado; quitar", () => {
  it("propietario y administrador; el admin no actúa sobre propietarios ni otros admins", async () => {
    const w = await setup("Matriz acciones admin");
    const owner = (
      await ctx.prisma.membership.findFirstOrThrow({
        where: { workspaceId: w.ws.workspaceId, role: { base: "OWNER" } },
      })
    ).id;
    const a = api(w.ws, w.admin.token);
    expect(
      (await a.patch(`/admin/members/${w.ana.membership.id}`, { jobTitle: "Jefa" })).status,
    ).toBe(200);
    expect((await a.post(`/admin/members/${w.luis.membership.id}/suspend`)).status).toBe(200);
    expect((await a.post(`/admin/members/${w.luis.membership.id}/reactivate`)).status).toBe(200);
    for (const target of [owner, w.admin2.membership.id]) {
      expect((await a.patch(`/admin/members/${target}`, { jobTitle: "x" })).status, target).toBe(
        403,
      );
      expect((await a.post(`/admin/members/${target}/suspend`)).status, target).toBe(403);
      expect((await a.delete(`/admin/members/${target}`)).status, target).toBe(403);
    }
    // El propietario sí puede con un administrador.
    expect(
      (await w.owner.patch(`/admin/members/${w.admin2.membership.id}`, { jobTitle: "x" })).status,
    ).toBe(200);
  });

  it("jefes, miembros, lectores, invitados y miembros con capacidades pero sin cargo: no", async () => {
    const w = await setup("Matriz acciones nadie");
    for (const who of [w.boss, w.deputy, w.ana, w.rita, w.guest, w.gestor]) {
      const a = api(w.ws, who.token);
      const id = w.lola.membership.id;
      expect((await a.patch(`/admin/members/${id}`, { jobTitle: "x" })).status).toBe(403);
      expect((await a.post(`/admin/members/${id}/suspend`)).status).toBe(403);
      expect((await a.post(`/admin/members/${id}/reactivate`)).status).toBe(403);
      expect((await a.delete(`/admin/members/${id}`)).status).toBe(403);
      expect((await a.post(`/admin/members/${id}/revoke-sessions`)).status).toBe(403);
      expect(
        (
          await a.post("/admin/members/bulk", {
            ids: [id],
            action: { type: "suspend" },
          })
        ).status,
      ).toBe(403);
    }
  });

  it("siempre queda un propietario", async () => {
    const w = await setup("Matriz último propietario");
    const owner = await ctx.prisma.membership.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, role: { base: "OWNER" } },
    });
    expect((await w.owner.delete(`/admin/members/${owner.id}`)).status).toBe(400);
  });
});

describe("departamentos y cargos", () => {
  it("jefa y subjefa suman y quitan en su área y subáreas; fuera, 404", async () => {
    const w = await setup("Matriz deptos jefe");
    for (const who of [w.boss, w.deputy]) {
      const a = api(w.ws, who.token);
      const nueva = await addMember(ctx, w.ws, { name: "Nuevo" });
      expect(
        (
          await a.post(`/admin/departments/${w.lab.id}/members`, {
            membershipIds: [nueva.membership.id],
          })
        ).status,
      ).toBe(200);
      expect(
        (await a.delete(`/admin/departments/${w.lab.id}/members/${nueva.membership.id}`)).status,
      ).toBe(204);
      expect(
        (
          await a.post(`/admin/departments/${w.compras.id}/members`, {
            membershipIds: [nueva.membership.id],
          })
        ).status,
      ).toBe(403); // lo ve (solo lectura), pero no es su área
    }
  });

  it("nadie toca a un rol igual o superior: ni admin, ni propietario; la subjefa no toca a la jefa ni a otra subjefa", async () => {
    const w = await setup("Matriz deptos jerarquía");
    const boss = api(w.ws, w.boss.token);
    const deputy = api(w.ws, w.deputy.token);
    const add = (a: ReturnType<typeof api>, id: string) =>
      a.post(`/admin/departments/${w.calidad.id}/members`, { membershipIds: [id] });
    expect((await add(boss, w.admin.membership.id)).status).toBe(403);
    expect((await add(boss, w.hugo.membership.id)).status).toBe(403); // otro jefe
    // La jefa sí puede con una subjefa; la subjefa no con la jefa ni con otra subjefa.
    expect((await add(boss, w.deputy.membership.id)).status).toBe(200);
    expect((await add(deputy, w.boss.membership.id)).status).toBe(403);
    expect((await add(deputy, w.rita.membership.id)).status).toBe(403);
    expect((await add(deputy, w.deputy.membership.id)).status).toBe(403);
    // Propietario y administrador sí pueden con cualquiera.
    expect((await add(w.owner, w.boss.membership.id)).status).toBe(200);
    expect((await add(api(w.ws, w.admin.token), w.hugo.membership.id)).status).toBe(200);
  });

  it("nombrar jefe y subjefe: propietario y admin; la jefa nombra subjefes de su área", async () => {
    const w = await setup("Matriz cargos");
    const put = (token: string, deptId: string, who: { membership: { id: string } }, p: string) =>
      api(w.ws, token).put(`/admin/departments/${deptId}/members/${who.membership.id}/position`, {
        position: p,
      });
    // La jefa nombra a Ana subjefa de Calidad y la releva.
    expect((await put(w.boss.token, w.calidad.id, w.ana, "DEPUTY")).status).toBe(200);
    expect((await put(w.boss.token, w.calidad.id, w.ana, "MEMBER")).status).toBe(200);
    // Y en una subárea (Lola está en Laboratorio, dentro de su rama).
    expect((await put(w.boss.token, w.lab.id, w.lola, "DEPUTY")).status).toBe(200);
    // No puede nombrar jefes, ni en áreas ajenas, ni la subjefa nombrar subjefes.
    expect((await put(w.boss.token, w.calidad.id, w.ana, "HEAD")).status).toBe(403);
    expect((await put(w.boss.token, w.compras.id, w.luis, "DEPUTY")).status).toBe(403);
    expect((await put(w.deputy.token, w.calidad.id, w.ana, "DEPUTY")).status).toBe(403);
    // Miembros, lectores y miembros con capacidades sin cargo: no.
    for (const who of [w.ana, w.rita, w.gestor]) {
      expect((await put(who.token, w.calidad.id, w.ana, "DEPUTY")).status).toBe(403);
    }
    // Administrador y propietario, cualquier cargo.
    expect((await put(w.admin.token, w.compras.id, w.luis, "HEAD")).status).toBe(200);
    expect((await put(w.ws.token, w.compras.id, w.hugo, "HEAD")).status).toBe(200);
    // Todo cambio de cargo queda auditado.
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "department.position.set" },
      }),
    ).toBeGreaterThanOrEqual(8);
  });
});

describe("Seguridad: solo el propietario", () => {
  it("el administrador, la jefa y el miembro con capacidades no la ven ni la cambian", async () => {
    const w = await setup("Matriz seguridad");
    expect((await w.owner.get("/admin/security")).body).toEqual({
      settings: { memberVisibility: "company", leadersCanInvite: true },
    });
    for (const who of [w.admin, w.boss, w.ana, w.gestor]) {
      const a = api(w.ws, who.token);
      expect((await a.get("/admin/security")).status).toBe(403);
      expect((await a.patch("/admin/security", { memberVisibility: "department" })).status).toBe(
        403,
      );
      expect((await a.patch("/admin/security", { leadersCanInvite: false })).status).toBe(403);
    }
    expect((await w.owner.patch("/admin/security", { memberVisibility: "nadie" })).status).toBe(
      400,
    );
    expect((await w.owner.patch("/admin/security", { leadersCanInvite: "no" })).status).toBe(400);
    expect((await w.owner.patch("/admin/security", {})).status).toBe(400);
    expect(
      (await w.owner.patch("/admin/security", { memberVisibility: "department" })).status,
    ).toBe(200);
    expect((await w.owner.patch("/admin/security", { leadersCanInvite: false })).status).toBe(200);
    expect((await w.owner.get("/admin/security")).body).toEqual({
      settings: { memberVisibility: "department", leadersCanInvite: false },
    });
    // Cada cambio de configuración queda auditado.
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "security.visibility.update" },
      }),
    ).toBe(2);
  });
});

describe("sin rol de sistema Jefe de departamento", () => {
  it("el rol no existe: el cargo basta para ser jefe, y el selector no lo ofrece", async () => {
    const w = await setup("Matriz sin rol jefe");
    expect(
      await ctx.prisma.role.count({
        where: { workspaceId: w.ws.workspaceId, name: "Jefe de departamento" },
      }),
    ).toBe(0);
    const options = (await w.owner.get("/admin/roles/options?q=jefe")).body as {
      items: { name: string }[];
    };
    expect(options.items).toEqual([]);
    const res = await w.owner.put(
      `/admin/departments/${w.compras.id}/members/${w.luis.membership.id}/position`,
      { position: "DEPUTY" },
    );
    expect(res.status).toBe(200);
    expect(
      (await ctx.prisma.membership.findUniqueOrThrow({ where: { id: w.luis.membership.id } }))
        .roleId,
    ).toBe(w.luis.role.id);
  });
});

describe("un administrador no actúa sobre otro administrador ni sobre el propietario", () => {
  it("la API rechaza cambiar rol, plaza, suspender, reactivar, quitar, cerrar sesiones y lote", async () => {
    const w = await setup("Matriz admin sobre admin");
    const ownerId = (
      await ctx.prisma.membership.findFirstOrThrow({
        where: { workspaceId: w.ws.workspaceId, role: { base: "OWNER" } },
      })
    ).id;
    const a = api(w.ws, w.admin.token);
    for (const target of [ownerId, w.admin2.membership.id]) {
      expect((await a.patch(`/admin/members/${target}`, { roleId: w.memberRole.id })).status).toBe(
        403,
      );
      expect((await a.patch(`/admin/members/${target}`, { seatType: "READER" })).status).toBe(403);
      expect((await a.post(`/admin/members/${target}/suspend`)).status).toBe(403);
      expect((await a.post(`/admin/members/${target}/reactivate`)).status).toBe(403);
      expect((await a.delete(`/admin/members/${target}`)).status).toBe(403);
      expect((await a.post(`/admin/members/${target}/revoke-sessions`)).status).toBe(403);
      const bulk = await a.post("/admin/members/bulk", {
        ids: [target],
        action: { type: "suspend" },
      });
      expect((bulk.body as { failed: number }).failed).toBe(1);
    }
    // Nada cambió.
    const after = await ctx.prisma.membership.findMany({
      where: { id: { in: [ownerId, w.admin2.membership.id] } },
    });
    expect(after.every((m) => m.status === "ACTIVE")).toBe(true);
  });
});

describe("Mi equipo y Departamentos para jefes", () => {
  it("la raíz de su árbol son sus áreas; no ven datos de propietarios ni administradores", async () => {
    const w = await setup("Matriz jefe árbol");
    // Una administradora que pertenece a Calidad no aparece en el equipo de la jefa.
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: w.calidad.id,
        membershipId: w.admin.membership.id,
      },
    });
    const a = api(w.ws, w.boss.token);
    const roots = (await a.get("/admin/departments?parent=root")).body as Paged<{ name: string }>;
    expect(names(roots)).toEqual(["Calidad", "Compras"]);
    const children = (await a.get(`/admin/departments?parent=${w.calidad.id}`)).body as Paged<{
      name: string;
    }>;
    expect(names(children)).toEqual(["Laboratorio"]);
    const team = (await a.get("/admin/members")).body as Paged<{ name: string }>;
    expect(names(team)).not.toContain("Adela Admin");
    expect((await a.get(`/admin/members/${w.admin.membership.id}`)).status).toBe(404);
    const inDept = (await a.get(`/admin/departments/${w.calidad.id}/members`)).body as Paged<{
      name: string;
    }>;
    expect(names(inDept)).not.toContain("Adela Admin");
    const org = (await a.get("/admin/members/org-chart")).body as OrgBody;
    const calidad = org.departments.items.find((b) => b.department.name === "Calidad");
    // En el organigrama (directorio) figura por nombre, pero sin datos de gestión.
    const adela = calidad?.members.items.find((m) => m.name === "Adela Admin");
    expect(adela?.management ?? null).toBeNull();
    // La administración sí ve a todos.
    const all = (await api(w.ws, w.admin.token).get(`/admin/departments/${w.calidad.id}/members`))
      .body as Paged<{ name: string }>;
    expect(names(all)).toContain("Adela Admin");
  });

  it("al invitar, jefa y subjefa solo ven el rol Miembro; la administración ve todos", async () => {
    const w = await setup("Matriz jefe roles");
    for (const who of [w.boss, w.deputy]) {
      const roles = (await api(w.ws, who.token).get("/admin/roles/options")).body as Paged<{
        name: string;
        base: string;
      }>;
      expect(roles.items.map((r) => r.name)).toEqual(["Miembro"]);
    }
    const all = (await w.owner.get("/admin/roles/options")).body as Paged<unknown>;
    expect(all.total).toBeGreaterThan(1);
    // Sin cargo, ni con capacidades de roles, se pide la lista.
    for (const who of [w.ana, w.rita, w.guest, w.gestor]) {
      expect((await api(w.ws, who.token).get("/admin/roles/options")).status).toBe(403);
    }
  });
});

describe("ruta del departamento", () => {
  it("devuelve los ancestros desde la raíz; con alcance propio, solo los de su área", async () => {
    const w = await setup("Matriz ruta");
    const sub = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Microbiología", parentId: w.lab.id },
    });
    const path = async (token: string) =>
      (
        (await api(w.ws, token).get(`/admin/departments/${sub.id}`)).body as {
          ancestors: { name: string }[];
        }
      ).ancestors.map((a) => a.name);
    expect(await path(w.ws.token)).toEqual(["Calidad", "Laboratorio"]);
    // La jefa de Calidad ve toda la rama.
    expect(await path(w.boss.token)).toEqual(["Calidad", "Laboratorio"]);
    await ctx.prisma.departmentMember.update({
      where: {
        departmentId_membershipId: { departmentId: w.lab.id, membershipId: w.lola.membership.id },
      },
      data: { position: "HEAD" },
    });
    // Con "toda la empresa", quien lidera Laboratorio ve la ruta completa…
    expect(await path(w.lola.token)).toEqual(["Calidad", "Laboratorio"]);
    // …y con "solo su departamento", solo lo suyo: no se revelan ancestros que no ve.
    await w.owner.patch("/admin/security", { memberVisibility: "department" });
    expect(await path(w.lola.token)).toEqual(["Laboratorio"]);
  });
});

describe('Departamentos: lectura según "Los miembros ven"', () => {
  interface DepartmentBody {
    id: string;
    name: string;
    access: "manage" | "read";
  }
  const listOf = async (w: World, token: string) =>
    (await api(w.ws, token).get("/admin/departments")).body as Paged<DepartmentBody>;

  it("toda la empresa: todos los miembros ven todo; gestionan solo los que lideran; el resto, solo lectura", async () => {
    const w = await setup("Deptos lectura empresa");
    for (const who of [w.ana, w.luis, w.boss, w.deputy]) {
      expect(names(await listOf(w, who.token))).toEqual(["Calidad", "Compras", "Laboratorio"]);
    }
    const access = async (token: string) =>
      Object.fromEntries((await listOf(w, token)).items.map((d) => [d.name, d.access]));
    expect(await access(w.ana.token)).toEqual({
      Calidad: "read",
      Compras: "read",
      Laboratorio: "read",
    });
    // La jefa gestiona Calidad y su subárea; Compras es ajena.
    expect(await access(w.boss.token)).toEqual({
      Calidad: "manage",
      Compras: "read",
      Laboratorio: "manage",
    });
    expect(await access(w.admin.token)).toEqual({
      Calidad: "manage",
      Compras: "manage",
      Laboratorio: "manage",
    });
    // Lectores e invitados no ven Departamentos.
    for (const who of [w.rita, w.guest]) {
      expect((await api(w.ws, who.token).get("/admin/departments")).status).toBe(403);
      expect((await api(w.ws, who.token).get(`/admin/departments/${w.calidad.id}`)).status).toBe(
        403,
      );
    }
    // Un miembro sin cargo lee el detalle, pero ninguna acción vale (403).
    const ana = api(w.ws, w.ana.token);
    expect((await ana.get(`/admin/departments/${w.compras.id}`)).body).toMatchObject({
      department: { name: "Compras", access: "read" },
    });
    const actions = [
      ana.get(`/admin/departments/${w.compras.id}/members`),
      ana.post(`/admin/departments/${w.compras.id}/members`, {
        membershipIds: [w.gestor.membership.id],
      }),
      ana.delete(`/admin/departments/${w.compras.id}/members/${w.luis.membership.id}`),
      ana.put(`/admin/departments/${w.compras.id}/members/${w.luis.membership.id}/position`, {
        position: "DEPUTY",
      }),
      ana.post(`/admin/departments/${w.compras.id}/members/${w.luis.membership.id}/move`, {
        toDepartmentId: w.calidad.id,
      }),
      ana.patch(`/admin/departments/${w.compras.id}`, { name: "Otro" }),
      ana.delete(`/admin/departments/${w.compras.id}`),
      ana.post("/admin/departments", { name: "Nuevo" }),
    ];
    for (const res of await Promise.all(actions)) expect(res.status).toBe(403);
    expect(await ctx.prisma.department.count({ where: { workspaceId: w.ws.workspaceId } })).toBe(3);
  });

  it("las personas de un departamento ajeno llegan sin email ni datos de gestión", async () => {
    const w = await setup("Deptos lectura personas");
    const res = await api(w.ws, w.ana.token).get(
      `/directory/departments/${w.compras.id}/members?pageSize=10`,
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      items: { name: string; jobTitle: string | null; management: unknown }[];
    };
    expect(body.items.map((p) => p.name).sort()).toEqual(["Hugo Compras", "Luis Compras"]);
    expect(body.items.every((p) => p.management === null)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/@|lastSeenAt/);
  });

  it("solo su departamento: cada uno ve los suyos y sus subáreas; lo demás no existe", async () => {
    const w = await setup("Deptos lectura depto");
    await w.owner.patch("/admin/security", { memberVisibility: "department" });
    const expected: [string, { token: string }, string[]][] = [
      ["ana (Calidad)", w.ana, ["Calidad", "Laboratorio"]],
      ["lola (Laboratorio)", w.lola, ["Laboratorio"]],
      ["luis (Compras)", w.luis, ["Compras"]],
      ["jefa de Calidad", w.boss, ["Calidad", "Laboratorio"]],
      ["propietario", w.ws, ["Calidad", "Compras", "Laboratorio"]],
      ["administradora", w.admin, ["Calidad", "Compras", "Laboratorio"]],
    ];
    for (const [who, person, visible] of expected) {
      expect(names(await listOf(w, person.token)), who).toEqual(visible);
    }
    const luis = api(w.ws, w.luis.token);
    expect((await luis.get(`/admin/departments/${w.calidad.id}`)).status).toBe(404);
    expect(
      (await luis.post(`/admin/departments/${w.calidad.id}/members`, { membershipIds: [] })).status,
    ).toBeGreaterThanOrEqual(400);
    // Las raíces del árbol de cada uno: sus áreas aunque el padre no se vea.
    const roots = (await api(w.ws, w.lola.token).get("/admin/departments?parent=root"))
      .body as Paged<DepartmentBody>;
    expect(names(roots)).toEqual(["Laboratorio"]);
    // Volver a toda la empresa los muestra de nuevo.
    await w.owner.patch("/admin/security", { memberVisibility: "company" });
    expect(names(await listOf(w, w.luis.token))).toEqual(["Calidad", "Compras", "Laboratorio"]);
  });
});

describe("Ver más del organigrama (directorio por departamento)", () => {
  type Org = {
    items: { name: string; management: { status: string } | null }[];
    total: number;
  };
  it("pagina y respeta la visibilidad y el alcance de gestión", async () => {
    const w = await setup("Matriz ver más");
    const get = (token: string, path: string) =>
      api(w.ws, token).get(`/directory/departments/${path}/members?pageSize=2`);
    // Cualquier miembro ve las personas del área (sin datos de gestión); pagina de a 2.
    const first = await get(w.luis.token, w.calidad.id);
    expect(first.status).toBe(200);
    const page = first.body as Org & { nextCursor: string | null };
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items.every((m) => m.management === null)).toBe(true);
    const next = await api(w.ws, w.luis.token).get(
      `/directory/departments/${w.calidad.id}/members?pageSize=2&cursor=${page.nextCursor ?? ""}`,
    );
    expect((next.body as Org).items).toHaveLength(2);
    // La jefa ve los datos de gestión de su área, no los de otra.
    const own = (await get(w.boss.token, w.calidad.id)).body as Org;
    expect(own.items.every((m) => m.management !== null)).toBe(true);
    const other = (await get(w.boss.token, w.compras.id)).body as Org;
    expect(other.items.every((m) => m.management === null)).toBe(true);
    // Sin departamento: solo quien ve toda la empresa.
    expect((await get(w.ws.token, "none")).status).toBe(200);
    // Lectores e invitados: no. Un departamento que no existe: 404.
    for (const who of [w.rita, w.guest]) {
      expect((await get(who.token, w.calidad.id)).status).toBe(403);
    }
    expect((await get(w.luis.token, "no-existe")).status).toBe(404);
  });

  it('con "solo su departamento", un miembro no ve otras áreas ni los suspendidos', async () => {
    const w = await setup("Matriz ver más depto");
    await w.owner.patch("/admin/security", { memberVisibility: "department" });
    const get = (token: string, id: string) =>
      api(w.ws, token).get(`/directory/departments/${id}/members`);
    expect((await get(w.luis.token, w.compras.id)).status).toBe(200);
    expect((await get(w.luis.token, w.calidad.id)).status).toBe(404);
    expect((await get(w.luis.token, "none")).status).toBe(404);
    await w.owner.post(`/admin/members/${w.hugo.membership.id}/suspend`);
    const visible = (await get(w.luis.token, w.compras.id)).body as Org;
    expect(visible.items.map((m) => m.name)).not.toContain("Hugo Compras");
    const manager = (await get(w.ws.token, w.compras.id)).body as Org;
    expect(manager.items.find((m) => m.name === "Hugo Compras")?.management?.status).toBe(
      "SUSPENDED",
    );
  });
});
