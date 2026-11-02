// Occupational health and safety, phase 4 (docs/spec/seguridad-salud.md, «Formación y evaluaciones»):
// required readings by position (core), courses over controlled documents, the «Leí y comprendo» as a
// training record with its expiry, confirming again once expired, in-person attendance and the review
// expiry of a published risk assessment (EVR).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

async function published(w: PagesWorld, docType = "PRC") {
  const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Aprueba" });
  const page = await w.makePage();
  const id = page.node.id;
  expect((await w.call("post", w.ws.token, `/nodes/${id}/controlled`, { docType })).status).toBe(
    201,
  );
  expect(
    (
      await w.call("post", w.editor.token, `/nodes/${id}/controlled/submit`, {
        approverIds: [admin.membership.id],
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await w.call("post", admin.token, `/nodes/${id}/controlled/decision`, {
        decision: "APPROVED",
      })
    ).status,
  ).toBe(204);
  expect((await w.call("post", admin.token, `/nodes/${id}/controlled/publish`)).status).toBe(204);
  return { id, admin };
}

async function world(label: string) {
  const w = await pagesWorld(ctx, label);
  expect((await w.call("put", w.ws.token, "/admin/safety", { enabled: true })).status).toBe(200);
  const position = await w.call("post", w.ws.token, "/admin/positions", { name: "Despiece" });
  const positionId = (position.body as { position: { id: string } }).position.id;
  await w.call("patch", w.ws.token, `/admin/members/${w.viewer.membership.id}`, { positionId });
  return { w, positionId };
}

interface CourseBody {
  course: { id: string };
  people: { membershipId: string; state: string; source: string | null }[];
}

describe("formación", () => {
  it("lectura por puesto; el «Leí y comprendo» de un curso es la constancia, con vencimiento", async () => {
    const { w, positionId } = await world("Formación lectura");
    const { id, admin } = await published(w);
    const ask = await w.call("put", admin.token, `/nodes/${id}/controlled/readings`, {
      positionId,
    });
    expect(ask.status, JSON.stringify(ask.body)).toBe(204);
    const mine = (await w.call("get", w.viewer.token, "/documents/readings")).body as {
      total: number;
    };
    expect(mine.total).toBe(1);

    expect((await w.call("post", w.viewer.token, "/safety/courses", { nodeId: id })).status).toBe(
      403,
    );
    const created = await w.call("post", w.ws.token, "/safety/courses", {
      nodeId: id,
      validityMonths: 12,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const courseId = (created.body as { course: { id: string } }).course.id;
    expect((await w.call("post", w.ws.token, "/safety/courses", { nodeId: id })).status).toBe(409);
    const detail = async (token = w.ws.token) =>
      (await w.call("get", token, `/safety/courses/${courseId}`)).body as CourseBody;
    expect((await detail()).people).toEqual([
      expect.objectContaining({ membershipId: w.viewer.membership.id, state: "pending" }),
    ]);

    expect(
      (await w.call("post", w.viewer.token, `/nodes/${id}/controlled/acknowledge`)).status,
    ).toBe(204);
    expect((await detail()).people[0]).toMatchObject({ state: "valid", source: "READING" });
    const training = await ctx.prisma.safetyTraining.findFirstOrThrow({
      where: { courseId, membershipId: w.viewer.membership.id },
    });
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { kind: "safety.training", subjectId: training.id },
    });
    expect(expiry.membershipId).toBe(w.viewer.membership.id);
    expect(
      (await w.call("post", w.viewer.token, `/safety/courses/${courseId}/confirm`)).status,
    ).toBe(409);

    // It expired: confirming again makes a new record and the old one stops telling.
    await ctx.prisma.safetyTraining.updateMany({
      where: { id: training.id },
      data: { validUntil: new Date("2020-01-01T00:00:00Z") },
    });
    expect((await detail()).people[0]?.state).toBe("expired");
    expect(
      (await w.call("post", w.viewer.token, `/safety/courses/${courseId}/confirm`)).status,
    ).toBe(204);
    expect((await detail()).people[0]?.state).toBe("valid");
    expect(
      (await ctx.prisma.expiry.findUniqueOrThrow({ where: { id: expiry.id } })).resolvedAt,
    ).not.toBeNull();
    // Each person sees only theirs.
    expect((await detail(w.viewer.token)).people.map((p) => p.membershipId)).toEqual([
      w.viewer.membership.id,
    ]);
  });

  it("formación presencial: solo quien gestiona registra asistentes", async () => {
    const { w } = await world("Formación presencial");
    const { id } = await published(w);
    const created = await w.call("post", w.ws.token, "/safety/courses", { nodeId: id });
    const courseId = (created.body as { course: { id: string } }).course.id;
    const body = { membershipIds: [w.editor.membership.id], completedOn: "2026-10-30" };
    expect(
      (await w.call("post", w.viewer.token, `/safety/courses/${courseId}/attendance`, body)).status,
    ).toBe(403);
    expect(
      (await w.call("post", w.ws.token, `/safety/courses/${courseId}/attendance`, body)).status,
    ).toBe(204);
    const detail = (await w.call("get", w.ws.token, `/safety/courses/${courseId}`))
      .body as CourseBody;
    expect(detail.people).toEqual([
      expect.objectContaining({
        membershipId: w.editor.membership.id,
        state: "valid",
        source: "IN_PERSON",
      }),
    ]);
    const sheet = await w.call(
      "get",
      w.ws.token,
      `/safety/people/${w.editor.membership.id}/training`,
    );
    expect((sheet.body as { items: { state: string }[] }).items[0]?.state).toBe("valid");
  });

  it("una evaluación de riesgos publicada deja su revisión como vencimiento", async () => {
    const { w } = await world("Formación EVR");
    const { id } = await published(w, "EVR");
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, kind: "safety.review", subjectId: id },
    });
    expect(expiry.resolvedAt).toBeNull();
    // Another type: nothing.
    const { id: other } = await published(w);
    expect(await ctx.prisma.expiry.count({ where: { subjectId: other } })).toBe(0);
  });
});
