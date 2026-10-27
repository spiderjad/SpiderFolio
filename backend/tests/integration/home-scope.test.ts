// Inicio (GET /overview): cada persona ve solo lo de su alcance. El propietario y los administradores
// ven la empresa (menos lo confidencial, en el caso de un administrador); un jefe, solo su área; el
// resto, lo propio; y de otra empresa nunca llega nada.
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

interface Home {
  scope: { leader: boolean; company: boolean };
  mine: { readings: { total: number }; approvals: { total: number } };
  shared: unknown[];
  leader: null | {
    compliance: {
      code: string;
      total: number;
      read: number;
      pending: number;
      overdue: number;
      noAccess: number;
    }[];
    reviewDue: { items: { code: string }[] };
    inReview: { items: { code: string }[] };
  };
  company: null | {
    kpis: {
      publishedDocuments: number;
      inReview: number;
      drafts: number;
      activePeople: number;
      readingCompliance: number | null;
    };
    activity: { uploads: number; publications: number; reads: number }[];
    topDocuments: { code: string | null }[];
  };
}

const home = async (w: PagesWorld, token: string, slug = w.ws.slug): Promise<Home> => {
  const res = await w.call("get", token, "/overview", undefined, slug);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Home;
};

/** Convierte una página en documento controlado ya publicado (sin pasar por el circuito de aprobación). */
async function publishedDoc(
  w: PagesWorld,
  nodeId: string,
  options: { code: string; departmentId?: string; reviewInDays?: number },
) {
  const workspaceId = w.ws.workspaceId;
  await ctx.prisma.controlledDocument.create({
    data: {
      workspaceId,
      nodeId,
      code: options.code,
      docType: "PRC",
      ownerDepartmentId: options.departmentId ?? null,
      publishedVersion: 1,
      createdById: w.ownerMembership.id,
      reviewDueAt: new Date(Date.now() + (options.reviewInDays ?? 300) * 86_400_000),
    },
  });
  await ctx.prisma.documentVersion.create({
    data: {
      workspaceId,
      nodeId,
      version: 1,
      status: "PUBLISHED",
      title: options.code,
      createdById: w.ownerMembership.id,
      publishedAt: new Date(),
    },
  });
}

async function department(w: PagesWorld, name: string) {
  return await ctx.prisma.department.create({ data: { workspaceId: w.ws.workspaceId, name } });
}

async function inDepartment(
  w: PagesWorld,
  departmentId: string,
  membershipId: string,
  position: "HEAD" | "MEMBER" = "MEMBER",
) {
  await ctx.prisma.departmentMember.create({
    data: { workspaceId: w.ws.workspaceId, departmentId, membershipId, position },
  });
}

/** Da VIEW sobre el espacio privado de la escena. */
async function canView(w: PagesWorld, membershipId: string) {
  await ctx.prisma.permission.create({
    data: {
      workspaceId: w.ws.workspaceId,
      spaceId: w.spaceId,
      membershipId,
      level: "VIEW",
      grantedById: w.ownerMembership.id,
    },
  });
}

describe("alcance del Inicio", () => {
  it("el propietario ve la empresa; un miembro, solo lo propio; un jefe, solo su área", async () => {
    const w = await pagesWorld(ctx, "Inicio alcance");
    const a = w.pageId;
    const b = (await w.makePage()).node.id;
    const calidad = await department(w, "Calidad");
    const produccion = await department(w, "Producción");
    await publishedDoc(w, a, { code: "PRC-A", departmentId: calidad.id, reviewInDays: 20 });
    await publishedDoc(w, b, { code: "PRC-B", departmentId: produccion.id });

    const leaderA = await addMember(ctx, w.ws, { name: "Jefa de Calidad" });
    const leaderB = await addMember(ctx, w.ws, { name: "Jefe de Producción" });
    const mateA = await addMember(ctx, w.ws, { name: "Compañera de Calidad" });
    await Promise.all([leaderA, leaderB, mateA].map((p) => canView(w, p.membership.id)));
    await inDepartment(w, calidad.id, leaderA.membership.id, "HEAD");
    await inDepartment(w, calidad.id, mateA.membership.id);
    await inDepartment(w, produccion.id, leaderB.membership.id, "HEAD");
    // Cada área debe leer su documento; la compañera de Calidad ya lo confirmó.
    for (const [nodeId, departmentId] of [
      [a, calidad.id],
      [b, produccion.id],
    ] as const) {
      await ctx.prisma.readRequirement.create({
        data: {
          workspaceId: w.ws.workspaceId,
          nodeId,
          version: 1,
          departmentId,
          createdById: w.ownerMembership.id,
        },
      });
    }
    await ctx.prisma.readAcknowledgment.create({
      data: {
        workspaceId: w.ws.workspaceId,
        nodeId: a,
        version: 1,
        membershipId: mateA.membership.id,
      },
    });

    const owner = await home(w, w.ws.token);
    expect(owner.scope).toEqual({ leader: false, company: true });
    expect(owner.company?.kpis.publishedDocuments).toBe(2);
    expect(owner.leader).toBeNull();

    // Un miembro sin cargo: nada de empresa ni de área; solo lo suyo.
    const editor = await home(w, w.editor.token);
    expect(editor.scope).toEqual({ leader: false, company: false });
    expect(editor.company).toBeNull();
    expect(editor.leader).toBeNull();

    // La jefa de Calidad ve solo su documento, con su cumplimiento (1 de 2 leyó) y su revisión próxima.
    const jefaA = await home(w, leaderA.token);
    expect(jefaA.company).toBeNull();
    expect(jefaA.leader?.compliance.map((row) => row.code)).toEqual(["PRC-A"]);
    expect(jefaA.leader?.compliance[0]).toMatchObject({ total: 2, read: 1, pending: 1 });
    expect(jefaA.leader?.reviewDue.items.map((row) => row.code)).toEqual(["PRC-A"]);

    // El jefe de Producción, solo el suyo; nunca el de Calidad.
    const jefeB = await home(w, leaderB.token);
    expect(jefeB.leader?.compliance.map((row) => row.code)).toEqual(["PRC-B"]);
    expect(jefeB.leader?.reviewDue.items).toEqual([]);

    // Sin acceso al espacio: ni área ni pendientes ni compartidos.
    const stranger = await home(w, w.stranger.token);
    expect(stranger.company).toBeNull();
    expect(stranger.leader).toBeNull();
    expect(stranger.mine.readings.total).toBe(0);
  });

  it("cada persona ve solo sus propios pendientes", async () => {
    const w = await pagesWorld(ctx, "Inicio pendientes");
    await publishedDoc(w, w.pageId, { code: "PRC-P" });
    await ctx.prisma.readRequirement.create({
      data: {
        workspaceId: w.ws.workspaceId,
        nodeId: w.pageId,
        version: 1,
        membershipId: w.editor.membership.id,
        createdById: w.ownerMembership.id,
      },
    });
    expect((await home(w, w.editor.token)).mine.readings.total).toBe(1);
    expect((await home(w, w.viewer.token)).mine.readings.total).toBe(0);
    expect((await home(w, w.ws.token)).mine.readings.total).toBe(0);
  });

  it("un administrador no cuenta lo confidencial; el propietario sí", async () => {
    const w = await pagesWorld(ctx, "Inicio confidencial");
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Administra" });
    const open = w.pageId;
    const created = await w.call("post", w.ws.token, "/spaces", {
      name: "Reservado",
      isPrivate: true,
      isConfidential: true,
    });
    expect(created.status).toBe(201);
    const secretSpace = (created.body as { space: { id: string } }).space.id;
    const page = await w.call("post", w.ws.token, `/spaces/${secretSpace}/pages`, {});
    const secret = (page.body as { page: { node: { id: string } } }).page.node.id;
    await publishedDoc(w, open, { code: "PRC-ABIERTO" });
    await publishedDoc(w, secret, { code: "PRC-SECRETO" });
    // Actividad: una subida en cada espacio (la del confidencial no la ve el administrador).
    await ctx.prisma.auditLog.createMany({
      data: [open, secret].map((entityId) => ({
        workspaceId: w.ws.workspaceId,
        actorId: w.ownerMembership.userId,
        action: "file.upload",
        entityType: "Node",
        entityId,
      })),
    });
    const totalOf = (h: Home) =>
      (h.company?.activity ?? []).reduce((sum, day) => sum + day.uploads, 0);

    const owner = await home(w, w.ws.token);
    expect(owner.company?.kpis.publishedDocuments).toBe(2);
    expect(totalOf(owner)).toBe(2);
    const adminHome = await home(w, admin.token);
    expect(adminHome.company?.kpis.publishedDocuments).toBe(1);
    expect(totalOf(adminHome)).toBe(1);
  });

  it("de otra empresa nunca llega nada", async () => {
    const w = await pagesWorld(ctx, "Inicio aislada");
    await publishedDoc(w, w.pageId, { code: "PRC-MIO" });
    // Quien es de la otra empresa recibe 404 en esta, y en la suya no ve nada de esta.
    const foreign = await w.call("get", w.outsider.token, "/overview");
    expect(foreign.status).toBe(404);
    const theirs = await home(w, w.outsider.token, w.outsider.slug);
    expect(theirs.company?.kpis.publishedDocuments).toBe(0);
    expect(theirs.company?.topDocuments).toEqual([]);
    expect(theirs.mine.readings.total).toBe(0);
  });
});

describe("cumplimiento de lectura: Inicio y detalle coinciden", () => {
  it("dan los mismos números, descontando y mostrando aparte a quien no tiene acceso", async () => {
    const w = await pagesWorld(ctx, "Inicio coincide");
    const area = await department(w, "Calidad");
    await publishedDoc(w, w.pageId, { code: "PRC-C", departmentId: area.id });
    const leader = await addMember(ctx, w.ws, { name: "Jefa" });
    const reader = await addMember(ctx, w.ws, { name: "Lee" });
    const late = await addMember(ctx, w.ws, { name: "Atrasada" });
    const waiting = await addMember(ctx, w.ws, { name: "Espera" });
    const noAccess = await addMember(ctx, w.ws, { name: "Sin acceso" });
    // Todos ven el espacio menos «Sin acceso».
    await Promise.all([leader, reader, late, waiting].map((p) => canView(w, p.membership.id)));
    await inDepartment(w, area.id, leader.membership.id, "HEAD");
    for (const person of [reader, late, waiting, noAccess]) {
      await inDepartment(w, area.id, person.membership.id);
    }
    const yesterday = new Date(Date.now() - 86_400_000);
    // Un requisito para el área (sin plazo) y otro con plazo vencido para «Atrasada».
    await ctx.prisma.readRequirement.createMany({
      data: [{ departmentId: area.id }, { membershipId: late.membership.id, dueAt: yesterday }].map(
        (subject) => ({
          workspaceId: w.ws.workspaceId,
          nodeId: w.pageId,
          version: 1,
          createdById: w.ownerMembership.id,
          ...subject,
        }),
      ),
    });
    await ctx.prisma.readAcknowledgment.create({
      data: {
        workspaceId: w.ws.workspaceId,
        nodeId: w.pageId,
        version: 1,
        membershipId: reader.membership.id,
      },
    });

    const detail = await w.call("get", leader.token, `/nodes/${w.pageId}/controlled/readings`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const summary = (detail.body as { summary: Record<string, number> }).summary;
    // Sanidad del escenario: hay de cada tipo.
    expect(summary).toMatchObject({ read: 1, overdue: 1, noAccess: 1 });
    expect(summary.pending).toBeGreaterThanOrEqual(1);

    const led = (await home(w, leader.token)).leader?.compliance[0];
    expect(led).toMatchObject({
      total: summary.total,
      read: summary.read,
      pending: summary.pending,
      overdue: summary.overdue,
      noAccess: summary.noAccess,
    });

    // El porcentaje de la empresa descuenta a quien no ve el documento: leído / (total - sin acceso).
    const owner = await home(w, w.ws.token);
    expect(owner.company?.kpis.readingCompliance).toBe(
      Math.round(((summary.read ?? 0) / ((summary.total ?? 0) - (summary.noAccess ?? 0))) * 100),
    );
  });
});
