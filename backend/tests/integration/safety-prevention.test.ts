// Prevention phases 6 to 9 (docs/spec/seguridad-salud.md, «Lo que falta»), security: the planning is
// safety.manage's and hides an accident's details without safety.health (and the database keeps origin
// and incident together); the indicators break down by department only for safety.health, who alone
// enters days of leave; emergencies and drills are safety.manage's, with the yearly drill reminder; the
// committee is managed with safety.manage and read by its current members only (a guest can't join),
// with the term and quarterly meeting reminders; another company's ids answer 404 everywhere.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
  type TestContext,
  type TestWorkspace,
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
});

type Member = Awaited<ReturnType<typeof addMember>>;

interface World {
  ws: TestWorkspace;
  /** safety.manage without safety.health. */
  manager: Member;
  /** safety.health without safety.manage. */
  health: Member;
  worker: Member;
  guest: Member;
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function world(name: string): Promise<World> {
  const ws = await createWorkspace(ctx, name);
  expect((await api(ws.slug, ws.token).put("/admin/safety", { enabled: true })).status).toBe(200);
  const role = async (label: string, capabilities: string[]) =>
    (
      await ctx.prisma.role.create({
        data: { workspaceId: ws.workspaceId, name: label, base: "MEMBER", capabilities },
      })
    ).id;
  return {
    ws,
    manager: await addMember(ctx, ws, {
      roleId: await role("Técnico PRL", ["safety.manage"]),
      name: "Técnica PRL",
    }),
    health: await addMember(ctx, ws, {
      roleId: await role("Salud", ["safety.health"]),
      name: "Médica",
    }),
    worker: await addMember(ctx, ws, { base: "MEMBER", name: "Operario" }),
    guest: await addMember(ctx, ws, { base: "GUEST", name: "Auditor externo" }),
  };
}

/** An accident with leave reported through the module's form; returns the case's id. */
async function accident(w: World): Promise<string> {
  const form = await api(w.ws.slug, w.worker.token).get("/safety/incident-form");
  const formId = (form.body as { form: { formId: string } }).form.formId;
  const res = await api(w.ws.slug, w.worker.token).post(`/forms/${formId}/records`, {
    version: 2,
    answers: {
      sst_fecha: day(-2),
      sst_lugar: "Sala de despiece",
      sst_persona: w.worker.membership.id,
      sst_tipo: "baja",
      sst_gravedad: "leve",
      sst_que: "Corte en la mano.",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const recordId = (res.body as { record: { id: string } }).record.id;
  return (
    await ctx.prisma.safetyIncident.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, recordId },
    })
  ).id;
}

const measure = (responsibleId: string) => ({
  description: "Instalar protector en la sierra",
  responsibleId,
  dueOn: day(30),
});

describe("planificación", () => {
  it("solo safety.manage; una medida de accidente no dice cuál sin safety.health", async () => {
    const w = await world("Prevención planificación");
    const incidentId = await accident(w);
    // The accident's measure is created from the case (safety.health).
    const fromCase = await api(w.ws.slug, w.health.token).post(
      `/safety/incidents/${incidentId}/actions`,
      measure(w.worker.membership.id),
    );
    expect(fromCase.status, JSON.stringify(fromCase.body)).toBe(201);
    const planned = await api(w.ws.slug, w.manager.token).post("/safety/planning", {
      origin: "OTHER",
      ...measure(w.worker.membership.id),
    });
    expect(planned.status, JSON.stringify(planned.body)).toBe(201);
    // Only safety.manage sees and plans.
    for (const who of [w.health, w.worker, w.guest]) {
      expect((await api(w.ws.slug, who.token).get("/safety/planning")).status).toBe(403);
      expect(
        (
          await api(w.ws.slug, who.token).post("/safety/planning", {
            origin: "OTHER",
            ...measure(w.worker.membership.id),
          })
        ).status,
      ).toBe(403);
    }
    const list = await api(w.ws.slug, w.manager.token).get("/safety/planning?status=all");
    expect(list.status).toBe(200);
    const items = (
      list.body as {
        items: { origin: string; canEdit: boolean; reference: { id: string | null } | null }[];
      }
    ).items;
    const fromIncident = items.find((item) => item.origin === "INCIDENT");
    expect(fromIncident?.reference?.id).toBeNull();
    expect(fromIncident?.canEdit).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain(incidentId);
    // The CSV doesn't say which either.
    const csv = await api(w.ws.slug, w.manager.token).get("/safety/planning/csv?status=all");
    expect(csv.status).toBe(200);
    expect(csv.text).not.toContain(incidentId);
    // Without safety.health it can't be changed or closed by the manager.
    const actionId = (fromCase.body as { action: { id: string } }).action.id;
    expect(
      (
        await api(w.ws.slug, w.manager.token).patch(`/safety/actions/${actionId}`, {
          priority: "HIGH",
        })
      ).status,
    ).toBe(404);
  });

  it("la base no deja una medida de accidente sin caso ni un caso en otra medida", async () => {
    const w = await world("Prevención CHECK");
    const incidentId = await accident(w);
    const base = {
      workspaceId: w.ws.workspaceId,
      description: "Medida",
      responsibleId: w.worker.membership.id,
      dueOn: new Date(`${day(10)}T00:00:00Z`),
      createdById: w.ws.membershipId,
    };
    await expect(
      ctx.prisma.safetyAction.create({ data: { ...base, origin: "INCIDENT" } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.safetyAction.create({ data: { ...base, origin: "OTHER", incidentId } }),
    ).rejects.toThrow();
  });

  it("una medida DRILL o COMMITTEE pide su simulacro o reunión, de esta empresa", async () => {
    const w = await world("Prevención orígenes");
    const other = await world("Prevención orígenes otra");
    const drill = await api(other.ws.slug, other.manager.token).post("/safety/drills", {
      date: day(-5),
      scenario: "FIRE",
    });
    const drillId = (drill.body as { drill: { id: string } }).drill.id;
    const m = api(w.ws.slug, w.manager.token);
    expect(
      (
        await m.post("/safety/planning", {
          origin: "DRILL",
          drillId,
          ...measure(w.worker.membership.id),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await m.post("/safety/planning", {
          origin: "COMMITTEE",
          meetingId: "no-existe",
          ...measure(w.worker.membership.id),
        })
      ).status,
    ).toBe(404);
  });
});

describe("indicadores", () => {
  it("por departamento solo con safety.health; los días de baja, solo safety.health", async () => {
    const w = await world("Prevención indicadores");
    const incidentId = await accident(w);
    const year = new Date().getUTCFullYear();
    const asManager = await api(w.ws.slug, w.manager.token).get(`/safety/indicators?year=${year}`);
    expect(asManager.status).toBe(200);
    expect(
      (asManager.body as { indicators: { departments: unknown } }).indicators.departments,
    ).toBeNull();
    const asHealth = await api(w.ws.slug, w.health.token).get(`/safety/indicators?year=${year}`);
    expect(asHealth.status).toBe(200);
    expect(
      Array.isArray(
        (asHealth.body as { indicators: { departments: unknown } }).indicators.departments,
      ),
    ).toBe(true);
    expect(
      (await api(w.ws.slug, w.worker.token).get(`/safety/indicators?year=${year}`)).status,
    ).toBe(403);
    // Days of leave.
    expect(
      (
        await api(w.ws.slug, w.manager.token).put(`/safety/incidents/${incidentId}/lost-days`, {
          lostDays: 5,
        })
      ).status,
    ).toBe(403);
    const set = await api(w.ws.slug, w.health.token).put(
      `/safety/incidents/${incidentId}/lost-days`,
      {
        lostDays: 5,
      },
    );
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(
      (await ctx.prisma.safetyIncident.findFirstOrThrow({ where: { id: incidentId } })).lostDays,
    ).toBe(5);
    // Hours and headcount: safety.manage.
    const month = `${String(year)}-01-01`;
    const stat = { month, departmentId: null, hoursWorked: 6000, avgHeadcount: 40 };
    expect(
      (await api(w.ws.slug, w.health.token).put("/safety/indicators/stats", stat)).status,
    ).toBe(403);
    expect(
      (await api(w.ws.slug, w.manager.token).put("/safety/indicators/stats", stat)).status,
    ).toBe(200);
  });
});

describe("emergencias y simulacros", () => {
  it("solo safety.manage; un simulacro deja el aviso anual un año después", async () => {
    const w = await world("Prevención emergencias");
    for (const who of [w.health, w.worker, w.guest]) {
      const a = api(w.ws.slug, who.token);
      expect((await a.get("/safety/emergencies")).status).toBe(403);
      expect((await a.get("/safety/drills")).status).toBe(403);
      expect((await a.post("/safety/drills", { date: day(-1), scenario: "FIRE" })).status).toBe(
        403,
      );
    }
    const m = api(w.ws.slug, w.manager.token);
    const team = await m.get("/safety/emergencies");
    expect(team.status).toBe(200);
    const created = await m.post("/safety/drills", { date: "2026-03-10", scenario: "AMMONIA" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await m.post("/safety/drills", { date: "2025-11-02", scenario: "FIRE" });
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, kind: "safety.drill", subjectId: "yearly" },
    });
    expect(expiry.dueOn.toISOString().slice(0, 10)).toBe("2027-03-10");
    // Someone's emergency role is seen by them (and by safety.manage), not by a colleague.
    const roles = (team.body as { team: { roles: { id: string }[] } }).team.roles;
    const roleId = roles[0]?.id ?? "";
    expect(
      (
        await m.post(`/safety/emergencies/roles/${roleId}/members`, {
          membershipId: w.worker.membership.id,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await api(w.ws.slug, w.worker.token).get(
          `/safety/people/${w.worker.membership.id}/emergency`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api(w.ws.slug, w.guest.token).get(
          `/safety/people/${w.worker.membership.id}/emergency`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("comité de seguridad y salud", () => {
  it("lo gestiona safety.manage; sus miembros lo leen; el resto, 404; un invitado no entra", async () => {
    const w = await world("Prevención comité");
    const m = api(w.ws.slug, w.manager.token);
    expect(
      (
        await m.post("/safety/committee/members", {
          membershipId: w.worker.membership.id,
          role: "DELEGATE",
          termStart: day(-300),
          termEnd: day(40),
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await m.post("/safety/committee/members", {
          membershipId: w.guest.membership.id,
          role: "SECRETARY",
        })
      ).status,
    ).toBe(404);
    const meeting = await m.post("/safety/meetings", { date: day(-10), kind: "ORDINARY" });
    expect(meeting.status, JSON.stringify(meeting.body)).toBe(201);
    const meetingId = (meeting.body as { meeting: { id: string } }).meeting.id;
    // The member reads, but changes nothing.
    const member = api(w.ws.slug, w.worker.token);
    expect((await member.get("/safety/committee")).status).toBe(200);
    expect((await member.get("/safety/meetings")).status).toBe(200);
    expect((await member.get(`/safety/meetings/${meetingId}`)).status).toBe(200);
    expect((await member.get(`/safety/meetings/${meetingId}/agreements`)).status).toBe(200);
    expect((await member.get("/safety/committee/access")).body).toEqual({
      manage: false,
      member: true,
    });
    expect(
      (await member.post("/safety/meetings", { date: day(-1), kind: "ORDINARY" })).status,
    ).toBe(403);
    expect((await member.patch(`/safety/meetings/${meetingId}`, { agenda: "x" })).status).toBe(403);
    expect((await member.post(`/safety/meetings/${meetingId}/minutes`)).status).toBe(403);
    expect((await member.get("/safety/committee/minutes-options")).status).toBe(403);
    expect(
      (
        await member.post("/safety/committee/members", {
          membershipId: w.health.membership.id,
          role: "DELEGATE",
        })
      ).status,
    ).toBe(403);
    // Whoever isn't on it (nor manages): 404.
    for (const who of [w.health, w.guest]) {
      const a = api(w.ws.slug, who.token);
      expect((await a.get("/safety/committee")).status).toBe(404);
      expect((await a.get("/safety/meetings")).status).toBe(404);
      expect((await a.get(`/safety/meetings/${meetingId}`)).status).toBe(404);
      expect((await a.get(`/safety/meetings/${meetingId}/agreements`)).status).toBe(404);
    }
    // Leaving the committee closes it to them.
    const row = await ctx.prisma.safetyCommitteeMember.findFirstOrThrow({
      where: { membershipId: w.worker.membership.id },
    });
    expect((await m.patch(`/safety/committee/members/${row.id}`, { ended: true })).status).toBe(
      204,
    );
    expect((await member.get("/safety/committee")).status).toBe(404);
  });

  it("avisos: fin del mandato de un delegado y reunión trimestral", async () => {
    const w = await world("Prevención comité avisos");
    const m = api(w.ws.slug, w.manager.token);
    const end = day(40);
    await m.post("/safety/committee/members", {
      membershipId: w.worker.membership.id,
      role: "DELEGATE",
      termEnd: end,
    });
    const row = await ctx.prisma.safetyCommitteeMember.findFirstOrThrow({
      where: { membershipId: w.worker.membership.id },
    });
    const mandate = await ctx.prisma.expiry.findFirstOrThrow({
      where: { kind: "safety.mandate", subjectId: row.id },
    });
    expect(mandate.dueOn.toISOString().slice(0, 10)).toBe(end);
    expect(mandate.resolvedAt).toBeNull();
    // Not a delegate any more: no reminder.
    await m.patch(`/safety/committee/members/${row.id}`, { role: "COMPANY_REP" });
    expect(
      (
        await ctx.prisma.expiry.findFirstOrThrow({
          where: { kind: "safety.mandate", subjectId: row.id },
        })
      ).resolvedAt,
    ).not.toBeNull();
    // Meetings: three months after the last ordinary one (an extraordinary doesn't count).
    await m.post("/safety/meetings", { date: "2026-09-15", kind: "ORDINARY" });
    await m.post("/safety/meetings", { date: "2026-10-20", kind: "EXTRAORDINARY" });
    const meeting = await ctx.prisma.expiry.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, kind: "safety.meeting", subjectId: "quarterly" },
    });
    expect(meeting.dueOn.toISOString().slice(0, 10)).toBe("2026-12-15");
  });
});

describe("aislamiento entre empresas", () => {
  it("los ids de otra empresa responden 404 en planificación, simulacros, emergencias y comité", async () => {
    const a = await world("Prevención tenant A");
    const b = await world("Prevención tenant B");
    const am = api(a.ws.slug, a.manager.token);
    const action = await am.post("/safety/planning", {
      origin: "OTHER",
      ...measure(a.worker.membership.id),
    });
    const actionId = (action.body as { action: { id: string } }).action.id;
    const drill = await am.post("/safety/drills", { date: day(-3), scenario: "EVACUATION" });
    const drillId = (drill.body as { drill: { id: string } }).drill.id;
    const team = await am.get("/safety/emergencies");
    const roleId = (team.body as { team: { roles: { id: string }[] } }).team.roles[0]?.id ?? "";
    await am.post("/safety/committee/members", {
      membershipId: a.worker.membership.id,
      role: "DELEGATE",
    });
    const memberId = (
      await ctx.prisma.safetyCommitteeMember.findFirstOrThrow({
        where: { membershipId: a.worker.membership.id },
      })
    ).id;
    const meeting = await am.post("/safety/meetings", { date: day(-2), kind: "ORDINARY" });
    const meetingId = (meeting.body as { meeting: { id: string } }).meeting.id;

    const bm = api(b.ws.slug, b.ws.token);
    expect((await bm.patch(`/safety/actions/${actionId}`, { priority: "HIGH" })).status).toBe(404);
    expect((await bm.post(`/safety/actions/${actionId}/done`, {})).status).toBe(404);
    expect((await bm.get(`/safety/drills/${drillId}`)).status).toBe(404);
    expect((await bm.patch(`/safety/drills/${drillId}`, { area: "x" })).status).toBe(404);
    expect(
      (await bm.patch(`/safety/emergencies/roles/${roleId}`, { name: "Intruso" })).status,
    ).toBe(404);
    expect(
      (
        await bm.post(`/safety/emergencies/roles/${roleId}/members`, {
          membershipId: b.worker.membership.id,
        })
      ).status,
    ).toBe(404);
    expect((await bm.patch(`/safety/committee/members/${memberId}`, { ended: true })).status).toBe(
      404,
    );
    expect((await bm.get(`/safety/meetings/${meetingId}`)).status).toBe(404);
    expect((await bm.get(`/safety/meetings/${meetingId}/agreements`)).status).toBe(404);
    expect((await bm.patch(`/safety/meetings/${meetingId}`, { agenda: "x" })).status).toBe(404);
    expect((await bm.post(`/safety/meetings/${meetingId}/minutes`)).status).toBe(404);
    expect(
      (
        await bm.post("/safety/planning", {
          origin: "DRILL",
          drillId,
          ...measure(b.worker.membership.id),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await bm.post("/safety/planning", {
          origin: "COMMITTEE",
          meetingId,
          ...measure(b.worker.membership.id),
        })
      ).status,
    ).toBe(404);
    // A's committee member can't read B's.
    expect((await api(b.ws.slug, a.worker.token).get("/safety/committee")).status).toBe(404);
    // Nothing of A changed.
    expect(
      (await ctx.prisma.safetyAction.findFirstOrThrow({ where: { id: actionId } })).priority,
    ).toBe("MEDIUM");
    expect(
      (await ctx.prisma.safetyCommitteeMember.findFirstOrThrow({ where: { id: memberId } }))
        .endedAt,
    ).toBeNull();
  });
});
