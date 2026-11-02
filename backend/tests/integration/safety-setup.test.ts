// Occupational health and safety, phase 1 (docs/spec/seguridad-salud.md): the company's job positions
// (list, permissions, assigning one and filtering people), turning the module on and off (owner only,
// space and risk assessment type created once, examples never repeated, data kept) and the expiry
// engine (thresholds at 8:00, once per person, resolved and moved dates, other companies untouched).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { forTenant } from "../../src/db/tenant.ts";
import { dayIn } from "../../src/lib/time-zone.ts";
import {
  registerExpiryKind,
  resolveExpiry,
  setExpiry,
} from "../../src/modules/expiries/expiries.service.ts";
import { sendExpiryNotices } from "../../src/modules/expiries/expiry-notices.ts";
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
  patch: (path: string, body?: object) =>
    request(app)
      .patch(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  put: (path: string, body?: object) =>
    request(app).put(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`).send(body),
  delete: (path: string) =>
    request(app).delete(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
});

interface PositionBody {
  id: string;
  name: string;
  people: number;
}
const items = (res: { body: unknown }) => (res.body as { items: PositionBody[] }).items;

describe("puestos", () => {
  it("el propietario crea, renombra y borra; los nombres no se repiten sin distinguir mayúsculas", async () => {
    const ws = await createWorkspace(ctx, "Puestos CRUD");
    const a = api(ws.slug, ws.token);
    const created = await a.post("/admin/positions", { name: "Operario de cámaras" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body as { position: PositionBody }).position.id;
    expect((await a.post("/admin/positions", { name: "operario de CÁMARAS" })).status).toBe(409);
    const renamed = await a.patch(`/admin/positions/${id}`, { name: "Operario de frío" });
    expect((renamed.body as { position: PositionBody }).position.name).toBe("Operario de frío");
    expect(items(await a.get("/admin/positions")).map((p) => p.name)).toEqual(["Operario de frío"]);
    expect((await a.delete(`/admin/positions/${id}`)).status).toBe(204);
    expect(items(await a.get("/admin/positions"))).toEqual([]);
    const actions = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: ws.workspaceId, entityType: "Position" },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((row) => row.action)).toEqual([
      "position.create",
      "position.update",
      "position.delete",
    ]);
  });

  it("solo quien gestiona departamentos los cambia; un miembro no los ve", async () => {
    const ws = await createWorkspace(ctx, "Puestos permisos");
    const member = await addMember(ctx, ws, { base: "MEMBER" });
    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    const m = api(ws.slug, member.token);
    expect((await m.post("/admin/positions", { name: "Encargado" })).status).toBe(403);
    expect((await m.get("/admin/positions")).status).toBe(403);
    const byAdmin = await api(ws.slug, admin.token).post("/admin/positions", { name: "Encargado" });
    expect(byAdmin.status).toBe(201);
  });

  it("se asigna a una persona, cuenta y filtra; borrarlo la deja sin puesto", async () => {
    const ws = await createWorkspace(ctx, "Puestos asignar");
    const other = await createWorkspace(ctx, "Puestos otra empresa");
    const person = await addMember(ctx, ws, { base: "MEMBER" });
    const a = api(ws.slug, ws.token);
    const id = (
      (await a.post("/admin/positions", { name: "Mantenimiento" })).body as {
        position: PositionBody;
      }
    ).position.id;
    const foreign = (
      (
        await api(other.slug, other.token).post("/admin/positions", {
          name: "Ajeno",
        })
      ).body as { position: PositionBody }
    ).position.id;
    expect(
      (await a.patch(`/admin/members/${person.membership.id}`, { positionId: foreign })).status,
    ).toBe(404);
    const assigned = await a.patch(`/admin/members/${person.membership.id}`, { positionId: id });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(items(await a.get("/admin/positions"))[0]?.people).toBe(1);
    const filtered = await a.get(`/admin/members?position=${id}`);
    expect((filtered.body as { items: { id: string }[] }).items.map((row) => row.id)).toEqual([
      person.membership.id,
    ]);
    const none = await a.get("/admin/members?position=none");
    expect((none.body as { items: { id: string }[] }).items.map((row) => row.id)).not.toContain(
      person.membership.id,
    );
    expect((await a.delete(`/admin/positions/${id}`)).status).toBe(204);
    const row = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: person.membership.id },
    });
    expect(row.positionId).toBeNull();
    // The other company's position is still there.
    expect(await ctx.prisma.position.count({ where: { id: foreign } })).toBe(1);
  });
});

interface SafetyBody {
  enabled: boolean;
  terms: "es" | "latam";
  space: { id: string; name: string } | null;
}
const safetyOf = (res: { body: unknown }) => (res.body as { safety: SafetyBody }).safety;

describe("activar el módulo", () => {
  it("solo el propietario; crea el espacio, el tipo EVR y los ejemplos una sola vez", async () => {
    const ws = await createWorkspace(ctx, "Módulo SST");
    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    expect((await api(ws.slug, admin.token).put("/admin/safety", { enabled: true })).status).toBe(
      403,
    );
    const a = api(ws.slug, ws.token);
    expect(safetyOf(await a.get("/admin/safety"))).toEqual({
      enabled: false,
      terms: "es",
      space: null,
    });
    const on = await a.put("/admin/safety", { enabled: true, terms: "latam", examples: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const first = safetyOf(on);
    expect(first).toMatchObject({ enabled: true, terms: "latam" });
    expect(first.space?.name).toBe("Seguridad y salud en el trabajo");
    const types = await ctx.prisma.documentType.findMany({
      where: { workspaceId: ws.workspaceId },
      select: { code: true, reviewMonths: true },
    });
    expect(types.find((type) => type.code === "EVR")).toEqual({ code: "EVR", reviewMonths: 12 });
    expect(types.length).toBeGreaterThan(1);
    const positions = await ctx.prisma.position.count({ where: { workspaceId: ws.workspaceId } });
    expect(positions).toBe(5);

    // Again: same space, nothing repeated.
    const again = safetyOf(await a.put("/admin/safety", { enabled: true, examples: true }));
    expect(again.space?.id).toBe(first.space?.id);
    expect(await ctx.prisma.position.count({ where: { workspaceId: ws.workspaceId } })).toBe(5);
    expect(
      await ctx.prisma.documentType.count({ where: { workspaceId: ws.workspaceId, code: "EVR" } }),
    ).toBe(1);

    // Off: nothing is deleted, and the app learns it from the session.
    const off = safetyOf(await a.put("/admin/safety", { enabled: false }));
    expect(off).toMatchObject({ enabled: false, terms: "latam", space: { id: first.space?.id } });
    expect(await ctx.prisma.space.count({ where: { id: first.space?.id ?? "" } })).toBe(1);
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${ws.token}`);
    const membership = (
      me.body as { memberships: { workspace: { slug: string; safety: unknown } }[] }
    ).memberships.find((m) => m.workspace.slug === ws.slug);
    expect(membership?.workspace.safety).toEqual({ enabled: false, terms: "latam" });
    const actions = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: ws.workspaceId, action: { startsWith: "safety." } },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((row) => row.action)).toEqual(["safety.enable", "safety.disable"]);
  });

  it("si borraron el espacio, al volver a activarlo crea otro", async () => {
    const ws = await createWorkspace(ctx, "Módulo SST espacio");
    const a = api(ws.slug, ws.token);
    const first = safetyOf(await a.put("/admin/safety", { enabled: true }));
    expect(first.space?.name).toBe("Prevención de riesgos laborales");
    await ctx.prisma.space.delete({ where: { id: first.space?.id ?? "" } });
    await a.put("/admin/safety", { enabled: false });
    const second = safetyOf(await a.put("/admin/safety", { enabled: true }));
    expect(second.space?.id).toBeDefined();
    expect(second.space?.id).not.toBe(first.space?.id);
  });

  it("rechaza un cambio vacío o términos que no existen", async () => {
    const ws = await createWorkspace(ctx, "Módulo SST validación");
    const a = api(ws.slug, ws.token);
    expect((await a.put("/admin/safety", {})).status).toBe(400);
    expect((await a.put("/admin/safety", { terms: "ar" })).status).toBe(400);
  });
});

describe("motor de vencimientos", () => {
  const described: string[] = [];
  registerExpiryKind("test.item", {
    describe: (_db, expiry, workspace) => {
      described.push(expiry.subjectId);
      return Promise.resolve(
        expiry.subjectId === "gone"
          ? null
          : { what: `Cosa ${expiry.subjectId}`, path: `/app/${workspace.slug}/cosas` },
      );
    },
  });
  const deps = () => ({ prisma: ctx.prisma, logger: ctx.deps.logger, jobs: ctx.deps.jobs });
  const notices = (membershipId: string) =>
    ctx.prisma.notification.findMany({
      where: { membershipId, kind: "expiry_due" },
      select: { expiryId: true, detail: true },
    });
  const today = () => dayIn(new Date(), "Europe/Madrid");
  const plusDays = (days: number) =>
    new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  it("avisa al llegar a un umbral, una sola vez por persona, y nunca a otra empresa", async () => {
    const ws = await createWorkspace(ctx, "Vencimientos");
    const other = await createWorkspace(ctx, "Vencimientos otra");
    const person = await addMember(ctx, ws, { base: "MEMBER" });
    const responsible = await addMember(ctx, ws, { base: "MEMBER" });
    const db = forTenant(ctx.prisma, ws.workspaceId);
    const expiry = await setExpiry(db, {
      kind: "test.item",
      subjectId: "a",
      dueOn: plusDays(7),
      membershipId: person.membership.id,
      responsibleId: responsible.membership.id,
    });
    // Far away: no threshold yet.
    await setExpiry(db, { kind: "test.item", subjectId: "far", dueOn: plusDays(90) });
    await sendExpiryNotices(deps(), new Date(), { anyHour: true });
    await sendExpiryNotices(deps(), new Date(), { anyHour: true });
    expect(await notices(person.membership.id)).toEqual([{ expiryId: expiry.id, detail: "7" }]);
    expect(await notices(responsible.membership.id)).toHaveLength(1);
    const row = await ctx.prisma.expiry.findUniqueOrThrow({ where: { id: expiry.id } });
    expect(row.noticesSent).toEqual([30, 7]);
    expect(
      await ctx.prisma.notification.count({
        where: { workspaceId: other.workspaceId, kind: "expiry_due" },
      }),
    ).toBe(0);

    // The bell names it with its kind.
    const bell = await api(ws.slug, person.token).get("/notifications");
    const item = (bell.body as { items: { kind: string; expiry: unknown }[] }).items.find(
      (n) => n.kind === "expiry_due",
    );
    expect(item?.expiry).toEqual({ what: "Cosa a", path: `/app/${ws.slug}/cosas` });
  });

  it("uno ya vencido avisa una vez; resuelto no avisa; mover la fecha vuelve a armarlo", async () => {
    const ws = await createWorkspace(ctx, "Vencimientos estados");
    const person = await addMember(ctx, ws, { base: "MEMBER" });
    const db = forTenant(ctx.prisma, ws.workspaceId);
    const late = await setExpiry(db, {
      kind: "test.item",
      subjectId: "late",
      dueOn: plusDays(-3),
      membershipId: person.membership.id,
    });
    await setExpiry(db, {
      kind: "test.item",
      subjectId: "done",
      dueOn: plusDays(1),
      membershipId: person.membership.id,
    });
    await resolveExpiry(db, "test.item", "done");
    await sendExpiryNotices(deps(), new Date(), { anyHour: true });
    await sendExpiryNotices(deps(), new Date(), { anyHour: true });
    expect(await notices(person.membership.id)).toEqual([{ expiryId: late.id, detail: "-3" }]);

    // Renewed further away, then due again: a new notice.
    await setExpiry(db, { kind: "test.item", subjectId: "late", dueOn: plusDays(0) });
    await sendExpiryNotices(deps(), new Date(), { anyHour: true });
    const after = await notices(person.membership.id);
    expect(after).toHaveLength(2);
    expect(after.map((n) => n.detail).sort()).toEqual(["-3", "0"]);
  });

  it("si el elemento ya no existe, se resuelve sin avisar; un tipo sin registrar no avisa", async () => {
    const ws = await createWorkspace(ctx, "Vencimientos huérfanos");
    const person = await addMember(ctx, ws, { base: "MEMBER" });
    const db = forTenant(ctx.prisma, ws.workspaceId);
    const gone = await setExpiry(db, {
      kind: "test.item",
      subjectId: "gone",
      dueOn: plusDays(2),
      membershipId: person.membership.id,
    });
    await setExpiry(db, {
      kind: "test.unknown",
      subjectId: "x",
      dueOn: plusDays(2),
      membershipId: person.membership.id,
    });
    await sendExpiryNotices(deps(), new Date(), { anyHour: true });
    expect(await notices(person.membership.id)).toEqual([]);
    const row = await ctx.prisma.expiry.findUniqueOrThrow({ where: { id: gone.id } });
    expect(row.resolvedAt).not.toBeNull();
    expect(described).toContain("gone");
  });

  it("no avisa a quien está suspendido", async () => {
    const ws = await createWorkspace(ctx, "Vencimientos suspendidos");
    const person = await addMember(ctx, ws, { base: "MEMBER", status: "SUSPENDED" });
    const db = forTenant(ctx.prisma, ws.workspaceId);
    await setExpiry(db, {
      kind: "test.item",
      subjectId: "s",
      dueOn: plusDays(0),
      membershipId: person.membership.id,
    });
    await sendExpiryNotices(deps(), new Date(), { anyHour: true });
    expect(await notices(person.membership.id)).toEqual([]);
  });
});
