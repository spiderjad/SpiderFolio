// Audit rooms (docs/spec/salas-de-auditoria.md): who builds them, and that the external auditor reaches
// nothing outside their room (other nodes, other rooms, other companies, health data, the app's routes),
// the one-time code (reused, expired, too many tries), expiry and revocation, a room's cookie that's
// useless in another, and that the auditor loses what the room's creator loses.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { sendEmailJob } from "../../src/jobs/handlers.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, paragraph } from "./pages-world.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const gotenberg = () => ctx.deps.env.GOTENBERG_URL !== undefined;

interface RoomBody {
  room: { id: string; state: string; shared: { id: string; title: string }[] };
}

async function world(label: string) {
  const w = await pagesWorld(ctx, label);
  const page = await w.makePage();
  expect(
    (
      await w.save(
        w.ws.token,
        page.node.id,
        page.revision,
        doc(paragraph("Procedimiento de limpieza.")),
      )
    ).status,
  ).toBe(200);
  const other = await w.makePage();
  const createRoom = async (token = w.ws.token, body: object = {}) => {
    const res = await w.call("post", token, "/admin/audit-rooms", {
      name: "Auditoría ISO",
      auditorEmail: "auditora@certificadora.test",
      expiresOn: day(10),
      ...body,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as RoomBody).room.id;
  };
  const addItem = async (roomId: string, item: object, token = w.ws.token) =>
    w.call("post", token, `/admin/audit-rooms/${roomId}/items`, item);
  return { ...w, sharedPage: page.node.id, otherPage: other.node.id, createRoom, addItem };
}

/** The code the worker would email to the auditor (a fake mailer catches it). */
async function codeFor(roomId: string): Promise<string> {
  expect((await request(app).post(`/api/v1/auditor/${roomId}/code`)).status).toBe(204);
  const sent: { to: string; text: string }[] = [];
  await sendEmailJob(
    {
      prisma: ctx.prisma,
      logger: createLogger(ctx.deps.env),
      appUrl: ctx.deps.env.APP_URL,
      storage: ctx.deps.storage,
      systemStorage: ctx.deps.systemStorage,
      mailer: {
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
      },
    },
    { kind: "audit-room-code", roomId },
  );
  expect(sent[0]?.to).toBe("auditora@certificadora.test");
  const code = /\b(\d{6})\b/u.exec(sent[0]?.text ?? "")?.[1];
  if (code === undefined) throw new Error("No llegó el código");
  return code;
}

const enter = (roomId: string, code: string) =>
  request(app).post(`/api/v1/auditor/${roomId}/session`).send({ code });

/** Enters the room and returns the session token (the cookie's value). */
async function signIn(roomId: string): Promise<string> {
  const res = await enter(roomId, await codeFor(roomId));
  expect(res.status, JSON.stringify(res.body)).toBe(204);
  const cookie = ([] as string[])
    .concat(res.headers["set-cookie"] ?? [])
    .find((c) => c.startsWith("sf_auditor="));
  expect(cookie).toContain(`Path=/api/v1/auditor/${roomId}`);
  expect(cookie).toContain("HttpOnly");
  return /sf_auditor=([^;]+)/u.exec(cookie ?? "")?.[1] ?? "";
}

const asAuditor = (token: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", `sf_auditor=${token}`),
  post: (path: string) => request(app).post(path).set("Cookie", `sf_auditor=${token}`),
});

describe("quién arma las salas", () => {
  it("hace falta audit.share; hasta 30 días y a futuro; cada uno ve las suyas", async () => {
    const w = await world("Salas quién");
    expect(
      (
        await w.call("post", w.editor.token, "/admin/audit-rooms", {
          name: "Sala",
          auditorEmail: "a@b.test",
          expiresOn: day(5),
        })
      ).status,
    ).toBe(403);
    const tooLong = await w.call("post", w.ws.token, "/admin/audit-rooms", {
      name: "Sala",
      auditorEmail: "a@b.test",
      expiresOn: day(40),
    });
    expect(tooLong.status).toBe(400);
    const past = await w.call("post", w.ws.token, "/admin/audit-rooms", {
      name: "Sala",
      auditorEmail: "a@b.test",
      expiresOn: day(-1),
    });
    expect(past.status).toBe(400);

    const role = await ctx.prisma.role.create({
      data: {
        workspaceId: w.ws.workspaceId,
        name: "Calidad auditorías",
        base: "MEMBER",
        capabilities: ["audit.share"],
      },
    });
    const sharer = await addMember(ctx, w.ws, { roleId: role.id, name: "Sara Comparte" });
    const ownersRoom = await w.createRoom();
    // Someone else with audit.share doesn't see (nor touch) the owner's room.
    expect((await w.call("get", sharer.token, `/admin/audit-rooms/${ownersRoom}`)).status).toBe(
      404,
    );
    expect(
      (await w.call("post", sharer.token, `/admin/audit-rooms/${ownersRoom}/revoke`)).status,
    ).toBe(404);
    // They only add what they see: the space is private and they have no access.
    const theirs = await w.createRoom(sharer.token);
    expect(
      (await w.addItem(theirs, { kind: "node", nodeId: w.sharedPage }, sharer.token)).status,
    ).toBe(404);
    // The owner sees every room.
    const list = (await w.call("get", w.ws.token, "/admin/audit-rooms")).body as {
      items: { id: string }[];
    };
    expect(list.items.map((room) => room.id).sort()).toEqual([ownersRoom, theirs].sort());
  });

  it("los datos de salud no entran en una sala", async () => {
    const w = await world("Salas salud");
    expect((await w.call("put", w.ws.token, "/admin/safety", { enabled: true })).status).toBe(200);
    const room = await w.createRoom();
    const form = await w.call("get", w.ws.token, "/safety/incident-form");
    const formId = (form.body as { form: { formId: string } }).form.formId;
    expect(
      (await w.addItem(room, { kind: "form-records", formId, from: day(-30), to: day(0) })).status,
    ).toBe(400);
    expect((await w.addItem(room, { kind: "node", nodeId: formId })).status).toBe(400);
    for (const kind of ["incidents", "fitness"]) {
      expect((await w.addItem(room, { kind, from: day(-30), to: day(0) })).status).toBe(400);
    }
  });
});

describe("el código de un solo uso", () => {
  it("vale una sola vez", async () => {
    const w = await world("Salas código único");
    const room = await w.createRoom();
    const code = await codeFor(room);
    expect((await enter(room, code)).status).toBe(204);
    expect((await enter(room, code)).status).toBe(400);
  });

  it("vencido no vale; uno nuevo reemplaza al anterior", async () => {
    const w = await world("Salas código vencido");
    const room = await w.createRoom();
    const first = await codeFor(room);
    const second = await codeFor(room);
    expect((await enter(room, first)).status).toBe(400);
    await ctx.prisma.auditRoomCode.updateMany({
      where: { roomId: room },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await enter(room, second)).status).toBe(400);
  });

  it("después de 5 intentos fallidos, ni el correcto vale", async () => {
    const w = await world("Salas código intentos");
    const room = await w.createRoom();
    const code = await codeFor(room);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) expect((await enter(room, wrong)).status).toBe(400);
    expect((await enter(room, code)).status).toBe(429);
    expect(await ctx.prisma.auditRoomSession.count({ where: { roomId: room } })).toBe(0);
  });
});

describe("el auditor solo llega a su sala", () => {
  it("ve lo compartido y nada más; cada acceso queda registrado", async () => {
    const w = await world("Salas alcance");
    const room = await w.createRoom();
    const added = (await w.addItem(room, { kind: "node", nodeId: w.sharedPage })).body as RoomBody;
    const itemId = added.room.shared[0]?.id ?? "";
    const token = await signIn(room);
    const auditor = asAuditor(token);

    const items = await auditor.get(`/api/v1/auditor/${room}/items`);
    expect(items.status).toBe(200);
    expect((items.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
      itemId,
    ]);

    const pdf = await auditor.get(`/api/v1/auditor/${room}/items/${itemId}/pdf`);
    if (gotenberg()) {
      expect(pdf.status).toBe(200);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      expect(pdf.headers["content-disposition"]).toMatch(/^inline/u);
    } else {
      expect(pdf.status).toBe(503);
    }
    // Another document of the company, through this item or by itself: no.
    expect(
      (await auditor.get(`/api/v1/auditor/${room}/items/${itemId}/pdf?node=${w.otherPage}`)).status,
    ).toBe(404);
    expect((await auditor.get(`/api/v1/auditor/${room}/items/${w.otherPage}/pdf`)).status).toBe(
      404,
    );
    // No download unless the room allows it.
    expect(
      (await auditor.get(`/api/v1/auditor/${room}/items/${itemId}/pdf?download=1`)).status,
    ).toBe(403);

    // The app's routes don't take the auditor's cookie.
    expect((await auditor.get(`/api/v1/w/${w.ws.slug}/spaces`)).status).toBe(401);
    expect((await auditor.get(`/api/v1/w/${w.ws.slug}/nodes/${w.sharedPage}`)).status).toBe(401);
    expect((await auditor.get("/api/v1/auth/me")).status).toBe(401);

    const log = await ctx.prisma.auditRoomAccess.findMany({
      where: { roomId: room },
      select: { action: true, ip: true },
    });
    expect(log.map((row) => row.action)).toContain("enter");
    if (gotenberg()) expect(log.map((row) => row.action)).toContain("view");
    // Whoever created it is told the first time.
    expect(
      await ctx.prisma.notification.count({
        where: { kind: "audit_room_access", membershipId: w.ownerMembership.id, detail: room },
      }),
    ).toBe(1);
  });

  it("la cookie de una sala no sirve en otra sala ni en otra empresa", async () => {
    const w = await world("Salas cookie");
    const first = await w.createRoom();
    const second = await w.createRoom();
    const page = (await w.addItem(second, { kind: "node", nodeId: w.sharedPage })).body as RoomBody;
    const token = await signIn(first);
    const auditor = asAuditor(token);
    expect((await auditor.get(`/api/v1/auditor/${second}/items`)).status).toBe(401);
    expect(
      (await auditor.get(`/api/v1/auditor/${second}/items/${page.room.shared[0]?.id ?? ""}/pdf`))
        .status,
    ).toBe(401);
    // A room of another company.
    const foreignRoom = await ctx.prisma.auditRoom.create({
      data: {
        workspaceId: w.outsider.workspaceId,
        name: "Ajena",
        auditorEmail: "otro@auditor.test",
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
        createdById: (
          await ctx.prisma.membership.findFirstOrThrow({
            where: { workspaceId: w.outsider.workspaceId },
          })
        ).id,
      },
    });
    expect((await auditor.get(`/api/v1/auditor/${foreignRoom.id}/items`)).status).toBe(401);
    // An item of one room asked through another (with a valid session of that other room): 404.
    const tokenSecond = await signIn(second);
    const firstItem = (await w.addItem(first, { kind: "node", nodeId: w.otherPage }))
      .body as RoomBody;
    expect(
      (
        await asAuditor(tokenSecond).get(
          `/api/v1/auditor/${second}/items/${firstItem.room.shared[0]?.id ?? ""}/pdf`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("vencimiento, revocación y quien la creó", () => {
  it("revocada, el auditor deja de entrar al instante", async () => {
    const w = await world("Salas revocar");
    const room = await w.createRoom();
    const token = await signIn(room);
    expect((await asAuditor(token).get(`/api/v1/auditor/${room}/items`)).status).toBe(200);
    expect((await w.call("post", w.ws.token, `/admin/audit-rooms/${room}/revoke`)).status).toBe(
      200,
    );
    expect((await asAuditor(token).get(`/api/v1/auditor/${room}/items`)).status).toBe(401);
    expect((await request(app).post(`/api/v1/auditor/${room}/code`)).status).toBe(403);
    const cover = await request(app).get(`/api/v1/auditor/${room}`);
    expect((cover.body as { room: { open: boolean } }).room.open).toBe(false);
  });

  it("vencida, tampoco", async () => {
    const w = await world("Salas vencida");
    const room = await w.createRoom();
    const token = await signIn(room);
    await ctx.prisma.auditRoom.update({
      where: { id: room },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await asAuditor(token).get(`/api/v1/auditor/${room}/items`)).status).toBe(403);
    expect((await request(app).post(`/api/v1/auditor/${room}/code`)).status).toBe(403);
  });

  it("si quien la creó pierde el acceso, el auditor también", async () => {
    const w = await world("Salas acceso del creador");
    const role = await ctx.prisma.role.create({
      data: {
        workspaceId: w.ws.workspaceId,
        name: "Calidad",
        base: "MEMBER",
        capabilities: ["audit.share"],
      },
    });
    const creator = await addMember(ctx, w.ws, { roleId: role.id, name: "Clara Crea" });
    const grant = await ctx.prisma.permission.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        membershipId: creator.membership.id,
        level: "VIEW",
        grantedById: w.ownerMembership.id,
      },
    });
    const room = await w.createRoom(creator.token);
    const added = (await w.addItem(room, { kind: "node", nodeId: w.sharedPage }, creator.token))
      .body as RoomBody;
    const itemId = added.room.shared[0]?.id ?? "";
    const token = await signIn(room);
    const auditor = asAuditor(token);
    // The creator loses access to the space: the item is still listed, unavailable, and can't be opened.
    await ctx.prisma.permission.delete({ where: { id: grant.id } });
    const items = (await auditor.get(`/api/v1/auditor/${room}/items`)).body as {
      items: { id: string; unavailable: boolean }[];
    };
    expect(items.items).toEqual([expect.objectContaining({ id: itemId, unavailable: true })]);
    expect((await auditor.get(`/api/v1/auditor/${room}/items/${itemId}/pdf`)).status).toBe(404);
    // The creator leaves the company: the room can't be opened at all.
    await ctx.prisma.membership.update({
      where: { id: creator.membership.id },
      data: { status: "SUSPENDED" },
    });
    expect((await auditor.get(`/api/v1/auditor/${room}/items`)).status).toBe(403);
  });
});
