// Occupational health and safety, the pending items (docs/spec/seguridad-salud.md): each attendee signs
// in-person training on their own phone (once, only for themselves, while open; another company's
// session is 404), the «under investigation» state of a case, the new case's email without health data
// and each person's sheet as a PDF (health data only for safety.health).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendEmailJob } from "../../src/jobs/handlers.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const SIGNATURE = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]).toString("base64")}`;

async function publishedCourse(w: PagesWorld): Promise<string> {
  const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Aprueba" });
  const page = await w.makePage();
  const id = page.node.id;
  expect(
    (await w.call("post", w.ws.token, `/nodes/${id}/controlled`, { docType: "PRC" })).status,
  ).toBe(201);
  await w.call("post", w.editor.token, `/nodes/${id}/controlled/submit`, {
    approverIds: [admin.membership.id],
  });
  await w.call("post", admin.token, `/nodes/${id}/controlled/decision`, { decision: "APPROVED" });
  expect((await w.call("post", admin.token, `/nodes/${id}/controlled/publish`)).status).toBe(204);
  const created = await w.call("post", w.ws.token, "/safety/courses", { nodeId: id });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return (created.body as { course: { id: string } }).course.id;
}

async function world(label: string) {
  const w = await pagesWorld(ctx, label);
  expect((await w.call("put", w.ws.token, "/admin/safety", { enabled: true })).status).toBe(200);
  const courseId = await publishedCourse(w);
  return { ...w, courseId };
}

interface SessionBody {
  session: {
    id: string;
    open: boolean;
    trainer: { name: string };
    attendees: { id: string; signedAt: string | null }[] | null;
    me: { listed: boolean; signed: boolean };
  };
}

describe("firma de la formación presencial desde el celular", () => {
  it("cada asistente de la lista firma una sola vez, solo por sí mismo, y el responsable lo ve", async () => {
    const w = await world("Firma celular");
    const open = (token: string) =>
      w.call("post", token, `/safety/courses/${w.courseId}/sign-sessions`, {
        attendeeIds: [w.editor.membership.id, w.viewer.membership.id],
        completedOn: "2026-11-03",
      });
    // Only whoever manages the module opens one.
    expect((await open(w.editor.token)).status).toBe(403);
    const created = await open(w.ws.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body as SessionBody).session.id;

    // An attendee sees the course, the day and who gave it, never the others.
    const seen = (await w.call("get", w.editor.token, `/safety/sign-sessions/${id}`))
      .body as SessionBody;
    expect(seen.session).toMatchObject({
      open: true,
      attendees: null,
      me: { listed: true, signed: false },
    });
    // Someone not on the list can't see it nor sign.
    expect((await w.call("get", w.commenter.token, `/safety/sign-sessions/${id}`)).status).toBe(
      403,
    );
    expect(
      (
        await w.call("post", w.commenter.token, `/safety/sign-sessions/${id}/sign`, {
          signature: SIGNATURE,
        })
      ).status,
    ).toBe(403);

    // Only for oneself: there's no field to sign for someone else.
    expect(
      (
        await w.call("post", w.editor.token, `/safety/sign-sessions/${id}/sign`, {
          signature: SIGNATURE,
          membershipId: w.viewer.membership.id,
        })
      ).status,
    ).toBe(400);
    const signed = await w.call("post", w.editor.token, `/safety/sign-sessions/${id}/sign`, {
      signature: SIGNATURE,
    });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect((signed.body as SessionBody).session.me.signed).toBe(true);
    // Once.
    expect(
      (
        await w.call("post", w.editor.token, `/safety/sign-sessions/${id}/sign`, {
          signature: SIGNATURE,
        })
      ).status,
    ).toBe(409);

    // Whoever gave it sees who signed and who's missing.
    const live = (await w.call("get", w.ws.token, `/safety/sign-sessions/${id}`))
      .body as SessionBody;
    const byId = new Map((live.session.attendees ?? []).map((a) => [a.id, a.signedAt]));
    expect(byId.get(w.editor.membership.id)).not.toBe(null);
    expect(byId.get(w.viewer.membership.id)).toBe(null);

    // It's an in-person training record like the tablet's: the day's PDF includes it.
    const training = await ctx.prisma.safetyTraining.findFirstOrThrow({
      where: { sessionId: id, membershipId: w.editor.membership.id },
    });
    expect(training).toMatchObject({ source: "IN_PERSON", createdById: w.ownerMembership.id });
    expect(training.completedAt.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(training.signature?.length).toBeGreaterThan(100);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: w.ws.workspaceId, entityId: id },
      select: { action: true },
    });
    expect(audit.map((row) => row.action).sort()).toEqual([
      "safety.training.session.open",
      "safety.training.session.sign",
    ]);

    // Closed, nobody else signs.
    expect((await w.call("post", w.editor.token, `/safety/sign-sessions/${id}/close`)).status).toBe(
      403,
    );
    const closed = await w.call("post", w.ws.token, `/safety/sign-sessions/${id}/close`);
    expect((closed.body as SessionBody).session.open).toBe(false);
    expect(
      (
        await w.call("post", w.viewer.token, `/safety/sign-sessions/${id}/sign`, {
          signature: SIGNATURE,
        })
      ).status,
    ).toBe(409);
  });

  it("vence sola: pasada la hora, no se firma", async () => {
    const w = await world("Firma vencida");
    const created = await w.call(
      "post",
      w.ws.token,
      `/safety/courses/${w.courseId}/sign-sessions`,
      {
        attendeeIds: [w.editor.membership.id],
        completedOn: "2026-11-03",
      },
    );
    const id = (created.body as SessionBody).session.id;
    const row = await ctx.prisma.safetySignSession.findUniqueOrThrow({ where: { id } });
    // 24 hours (createdAt comes from the database, expiresAt from the app: a few ms apart).
    expect(
      Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - 24 * 3_600_000),
    ).toBeLessThan(5000);
    await ctx.prisma.safetySignSession.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await w.call("post", w.editor.token, `/safety/sign-sessions/${id}/sign`, {
          signature: SIGNATURE,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        (await w.call("get", w.ws.token, `/safety/courses/${w.courseId}/sign-sessions`)).body as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  });

  it("la sesión de otra empresa es 404", async () => {
    const w = await world("Firma aislamiento");
    const created = await w.call(
      "post",
      w.ws.token,
      `/safety/courses/${w.courseId}/sign-sessions`,
      {
        attendeeIds: [w.editor.membership.id],
        completedOn: "2026-11-03",
      },
    );
    const id = (created.body as SessionBody).session.id;
    const slug = w.outsider.slug;
    await w.call("put", w.outsider.token, "/admin/safety", { enabled: true }, slug);
    for (const [method, path, body] of [
      ["get", `/safety/sign-sessions/${id}`, undefined],
      ["post", `/safety/sign-sessions/${id}/sign`, { signature: SIGNATURE }],
      ["post", `/safety/sign-sessions/${id}/close`, undefined],
      ["get", `/safety/courses/${w.courseId}/sign-sessions`, undefined],
    ] as const) {
      const res = await w.call(method, w.outsider.token, path, body, slug);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // Someone of another company can't be on the list either.
    const foreign = await ctx.prisma.membership.findFirstOrThrow({
      where: { workspaceId: w.outsider.workspaceId },
    });
    expect(
      (
        await w.call("post", w.ws.token, `/safety/courses/${w.courseId}/sign-sessions`, {
          attendeeIds: [foreign.id],
          completedOn: "2026-11-03",
        })
      ).status,
    ).toBe(404);
  });
});

describe("accidentes: en investigación y aviso por email", () => {
  async function incidentWorld(label: string) {
    const w = await pagesWorld(ctx, label);
    expect((await w.call("put", w.ws.token, "/admin/safety", { enabled: true })).status).toBe(200);
    const form = await w.call("get", w.editor.token, "/safety/incident-form");
    const formId = (form.body as { form: { formId: string } }).form.formId;
    const res = await w.call("post", w.editor.token, `/forms/${formId}/records`, {
      version: 2,
      answers: {
        sst_fecha: "2026-10-30",
        sst_lugar: "Sala de despiece",
        sst_persona: w.viewer.membership.id,
        sst_tipo: "baja",
        sst_gravedad: "leve",
        sst_que: "Corte en la mano con la sierra.",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const incident = await ctx.prisma.safetyIncident.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId },
    });
    return { ...w, incidentId: incident.id };
  }

  it("abierto → en investigación → cerrado; «abiertos» incluye los que se investigan", async () => {
    const w = await incidentWorld("Accidente investigación");
    const ids = async (status: string) =>
      (
        (await w.call("get", w.ws.token, `/safety/incidents?status=${status}`)).body as {
          items: { id: string; status: string }[];
        }
      ).items.map((row) => `${row.id}:${row.status}`);
    const investigated = await w.call(
      "post",
      w.ws.token,
      `/safety/incidents/${w.incidentId}/investigate`,
    );
    expect(investigated.status, JSON.stringify(investigated.body)).toBe(200);
    expect((investigated.body as { incident: { status: string } }).incident.status).toBe(
      "INVESTIGATING",
    );
    expect(
      (await w.call("post", w.ws.token, `/safety/incidents/${w.incidentId}/investigate`)).status,
    ).toBe(409);
    expect(await ids("open")).toEqual([`${w.incidentId}:INVESTIGATING`]);
    expect(await ids("investigating")).toEqual([`${w.incidentId}:INVESTIGATING`]);
    expect(await ids("closed")).toEqual([]);
    // Health data: only safety.health (the editor reported it but can't move it).
    expect(
      (await w.call("post", w.editor.token, `/safety/incidents/${w.incidentId}/close`)).status,
    ).toBe(403);
    expect(
      (await w.call("post", w.ws.token, `/safety/incidents/${w.incidentId}/close`)).status,
    ).toBe(200);
    expect(await ids("closed")).toEqual([`${w.incidentId}:CLOSED`]);
    const audit = await ctx.prisma.auditLog.count({
      where: { workspaceId: w.ws.workspaceId, action: "safety.incident.investigate" },
    });
    expect(audit).toBe(1);
  });

  it("el caso nuevo llega por email a quien tiene datos de salud, sin el detalle", async () => {
    const w = await incidentWorld("Accidente email");
    const notice = await ctx.prisma.notification.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, kind: "safety_incident" },
    });
    expect(notice.membershipId).toBe(w.ownerMembership.id);
    const jobs = await ctx.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM pgboss.job WHERE name = 'email-send' AND data->>'notificationId' = $1`,
      notice.id,
    );
    expect(jobs).toHaveLength(1);
    const sent: { to: string; subject: string; html: string; text: string }[] = [];
    await sendEmailJob(
      {
        prisma: ctx.prisma,
        logger: createLogger(ctx.deps.env),
        appUrl: ctx.deps.env.APP_URL,
        storage: ctx.deps.storage,
        systemStorage: ctx.deps.systemStorage,
        mailer: {
          send: (message) => {
            sent.push(message as never);
            return Promise.resolve();
          },
        },
      },
      { kind: "safety-incident-notice", notificationId: notice.id },
    );
    expect(sent).toHaveLength(1);
    const email = sent[0];
    expect(email?.to).toBe(w.ws.owner.email);
    const all = `${email?.subject ?? ""} ${email?.html ?? ""} ${email?.text ?? ""}`;
    expect(all).toContain(`/seguridad/incidentes/${w.incidentId}`);
    expect(all).toContain("Edith Editora");
    // Never what happened nor who was hurt.
    expect(all).not.toContain("Corte en la mano");
    expect(all).not.toContain("Vera Visora");
    expect(all).not.toContain("Sala de despiece");
  });
});

describe("ficha por persona en PDF", () => {
  it("la descarga quien ve a la persona; otra persona sin permiso, 404", async () => {
    const w = await pagesWorld(ctx, "Ficha PDF");
    expect((await w.call("put", w.ws.token, "/admin/safety", { enabled: true })).status).toBe(200);
    const pdf = await w.call("get", w.ws.token, `/safety/people/${w.viewer.membership.id}/pdf`);
    if (ctx.deps.env.GOTENBERG_URL === undefined) {
      expect(pdf.status).toBe(503);
    } else {
      expect(pdf.status, JSON.stringify(pdf.body)).toBe(200);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { workspaceId: w.ws.workspaceId, action: "safety.person.export" },
      });
      // The owner has safety.health: the sheet included the health parts.
      expect(audit.metadata).toEqual({ fitness: true, incidents: true });
    }
    // A plain member only sees their own sheet.
    expect(
      (await w.call("get", w.editor.token, `/safety/people/${w.viewer.membership.id}/pdf`)).status,
    ).toBe(404);
    // Another company's person: 404.
    const foreign = await ctx.prisma.membership.findFirstOrThrow({
      where: { workspaceId: w.outsider.workspaceId },
    });
    expect((await w.call("get", w.ws.token, `/safety/people/${foreign.id}/pdf`)).status).toBe(404);
  });

  it("sin safety.health no lleva aptitud ni accidentes de otra persona", async () => {
    const w = await pagesWorld(ctx, "Ficha PDF sin salud");
    expect((await w.call("put", w.ws.token, "/admin/safety", { enabled: true })).status).toBe(200);
    if (ctx.deps.env.GOTENBERG_URL === undefined) return;
    const role = await w.call("post", w.ws.token, "/admin/roles", {
      name: "Técnico de prevención",
      base: "MEMBER",
      capabilities: ["safety.manage"],
    });
    const tech = await addMember(ctx, w.ws, {
      roleId: (role.body as { role: { id: string } }).role.id,
    });
    expect(
      (await w.call("get", tech.token, `/safety/people/${w.viewer.membership.id}/pdf`)).status,
    ).toBe(200);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, action: "safety.person.export" },
    });
    expect(audit.metadata).toEqual({ fitness: false, incidents: false });
  });
});
