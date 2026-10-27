// Documentos controlados (módulo 6): quién convierte, aprueba, publica y lee; una sola vigente;
// contenido congelado en revisión; lecturas solo propias; recientes privados; panel por alcance.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, paragraph, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface Info {
  controlled: null | {
    code: string;
    status: string;
    publishedVersion: number | null;
    versions: {
      version: number;
      status: string;
      approvals: { decision: string | null; selfApproved: boolean }[];
    }[];
    actions: { canSubmit: boolean; canDecide: boolean; canPublish: boolean; canWithdraw: boolean };
  };
  canConvert: boolean;
}

const convert = (w: PagesWorld, id: string, body: object = { docType: "PRC" }) =>
  w.call("post", w.ws.token, `/nodes/${id}/controlled`, body);

const infoOf = async (w: PagesWorld, token: string, id: string) =>
  (await w.call("get", token, `/nodes/${id}/controlled`)).body as Info;

const submit = (w: PagesWorld, token: string, id: string, approverIds: string[]) =>
  w.call("post", token, `/nodes/${id}/controlled/submit`, { approverIds });

const decide = (w: PagesWorld, token: string, id: string, decision: string, comment?: string) =>
  w.call("post", token, `/nodes/${id}/controlled/decision`, { decision, comment });

const publish = (w: PagesWorld, token: string, id: string) =>
  w.call("post", token, `/nodes/${id}/controlled/publish`);

async function revisionOf(w: PagesWorld, id: string): Promise<number> {
  return ((await w.call("get", w.ws.token, `/pages/${id}`)).body as { page: { revision: number } })
    .page.revision;
}

const edit = async (w: PagesWorld, token: string, id: string, text: string) =>
  w.save(token, id, await revisionOf(w, id), doc(paragraph(text)));

const textOf = async (w: PagesWorld, token: string, id: string): Promise<string> =>
  JSON.stringify(
    ((await w.call("get", token, `/pages/${id}`)).body as { page: { content: unknown } }).page
      .content,
  );

/** Una página controlada y publicada (v1) por el flujo completo. */
async function publishedPage(w: PagesWorld, text = "Texto vigente") {
  const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Aprueba" });
  const page = await w.makePage();
  const id = page.node.id;
  expect((await convert(w, id)).status).toBe(201);
  expect((await edit(w, w.editor.token, id, text)).status).toBe(200);
  expect((await submit(w, w.editor.token, id, [admin.membership.id])).status).toBe(204);
  expect((await decide(w, admin.token, id, "APPROVED")).status).toBe(204);
  expect((await publish(w, admin.token, id)).status).toBe(204);
  return { id, admin };
}

describe("convertir en documento controlado", () => {
  it("solo quien gestiona; carpetas no; código único por tipo y sin repetir", async () => {
    const w = await pagesWorld(ctx, "Docs convertir");
    const a = (await w.makePage()).node.id;
    const b = (await w.makePage()).node.id;
    const body = { docType: "PRC" };
    expect((await w.call("post", w.editor.token, `/nodes/${a}/controlled`, body)).status).toBe(403);
    expect((await w.call("post", w.stranger.token, `/nodes/${a}/controlled`, body)).status).toBe(
      404,
    );
    expect((await w.call("post", w.outsider.token, `/nodes/${a}/controlled`, body)).status).toBe(
      404,
    );
    expect((await convert(w, a, { docType: "NOPE" })).status).toBe(400);
    const folder = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, {
      name: "Carpeta",
    });
    const folderId = (folder.body as { node: { id: string } }).node.id;
    expect((await convert(w, folderId)).status).toBe(400);

    expect((await convert(w, a)).status).toBe(201);
    expect((await convert(w, a)).status).toBe(409);
    expect((await convert(w, b)).status).toBe(201);
    const codes = await Promise.all(
      [a, b].map(async (id) => (await infoOf(w, w.ws.token, id)).controlled?.code),
    );
    expect(codes).toEqual(["PRC-001", "PRC-002"]);
    // Quien solo lee ve el estado pero no puede convertir.
    const seen = await infoOf(w, w.viewer.token, a);
    expect(seen.controlled?.code).toBe("PRC-001");
    expect(seen.canConvert).toBe(false);
  });
});

describe("aprobación y publicación", () => {
  it("solo aprueban quienes pueden aprobar y ven el documento; el contenido queda congelado", async () => {
    const w = await pagesWorld(ctx, "Docs aprobar");
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Aprueba" });
    // Un rol con la capacidad de aprobar pero sin acceso al espacio privado no puede ser aprobador.
    const role = await ctx.prisma.role.create({
      data: {
        workspaceId: w.ws.workspaceId,
        name: "Aprobador sin espacio",
        base: "MEMBER",
        capabilities: ["documents.approve"],
      },
    });
    const blind = await addMember(ctx, w.ws, { roleId: role.id, name: "Ciro Ciego" });
    const id = (await w.makePage()).node.id;
    await convert(w, id);

    expect((await submit(w, w.viewer.token, id, [admin.membership.id])).status).toBe(403);
    expect((await submit(w, w.editor.token, id, [w.viewer.membership.id])).status).toBe(400);
    expect((await submit(w, w.editor.token, id, [blind.membership.id])).status).toBe(400);
    expect((await submit(w, w.editor.token, id, [])).status).toBe(400);
    expect((await submit(w, w.editor.token, id, [admin.membership.id])).status).toBe(204);

    // En revisión el texto no se toca.
    expect((await edit(w, w.editor.token, id, "Cambio a escondidas")).status).toBe(409);
    // Solo quien tiene la aprobación pendiente decide.
    expect((await decide(w, w.editor.token, id, "APPROVED")).status).toBe(403);
    expect((await decide(w, w.ws.token, id, "APPROVED")).status).toBe(403);
    // Pedir cambios pide motivo y devuelve a borrador.
    expect((await decide(w, admin.token, id, "CHANGES_REQUESTED")).status).toBe(400);
    expect(
      (await decide(w, admin.token, id, "CHANGES_REQUESTED", "Falta el responsable")).status,
    ).toBe(204);
    expect((await infoOf(w, w.ws.token, id)).controlled?.status).toBe("DRAFT");
    expect((await edit(w, w.editor.token, id, "Corregido")).status).toBe(200);

    expect((await submit(w, w.editor.token, id, [admin.membership.id])).status).toBe(204);
    // Publicar antes de aprobar no se puede, ni por quien no puede aprobar.
    expect((await publish(w, admin.token, id)).status).toBe(409);
    expect((await decide(w, admin.token, id, "APPROVED")).status).toBe(204);
    expect((await publish(w, w.editor.token, id)).status).toBe(403);
    expect((await publish(w, admin.token, id)).status).toBe(204);
    expect((await infoOf(w, w.ws.token, id)).controlled).toMatchObject({
      status: "PUBLISHED",
      publishedVersion: 1,
    });
  });

  it("con varios aprobadores deben aprobar todos", async () => {
    const w = await pagesWorld(ctx, "Docs varios");
    const one = await addMember(ctx, w.ws, { base: "ADMIN", name: "Uno Admin" });
    const two = await addMember(ctx, w.ws, { base: "ADMIN", name: "Dos Admin" });
    const id = (await w.makePage()).node.id;
    await convert(w, id);
    await submit(w, w.editor.token, id, [one.membership.id, two.membership.id]);
    await decide(w, one.token, id, "APPROVED");
    expect((await infoOf(w, w.ws.token, id)).controlled?.status).toBe("IN_REVIEW");
    expect((await publish(w, one.token, id)).status).toBe(409);
    await decide(w, two.token, id, "APPROVED");
    expect((await infoOf(w, w.ws.token, id)).controlled?.status).toBe("APPROVED");
  });

  it("sin autoaprobación por defecto; si se permite, queda marcada y auditada", async () => {
    const w = await pagesWorld(ctx, "Docs autoaprobación");
    const author = await addMember(ctx, w.ws, { base: "ADMIN", name: "Autor Admin" });
    const id = (await w.makePage()).node.id;
    await convert(w, id);
    expect((await submit(w, author.token, id, [author.membership.id])).status).toBe(400);
    // Solo el propietario cambia la opción en Seguridad.
    expect(
      (await w.call("patch", author.token, "/admin/security", { allowSelfApproval: true })).status,
    ).toBe(403);
    expect(
      (await w.call("patch", w.ws.token, "/admin/security", { allowSelfApproval: true })).status,
    ).toBe(200);
    expect((await submit(w, author.token, id, [author.membership.id])).status).toBe(204);
    expect((await decide(w, author.token, id, "APPROVED")).status).toBe(204);
    const approvals = (await infoOf(w, w.ws.token, id)).controlled?.versions[0]?.approvals;
    expect(approvals).toMatchObject([{ decision: "APPROVED", selfApproved: true }]);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "document.approved", entityId: id },
      }),
    ).toBe(1);
  });
});

describe("revisión: comentarios, pedir cambios y rechazo", () => {
  /** Documento en revisión con Sergi (jefe de Finanzas, con acceso de solo lectura) como revisor. */
  async function inReview(label: string) {
    const w = await pagesWorld(ctx, label);
    const finanzas = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Finanzas" },
    });
    const sergi = await addMember(ctx, w.ws, { name: "Sergi Reich" });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: finanzas.id,
        membershipId: sergi.membership.id,
        position: "HEAD",
      },
    });
    const id = (await w.makePage()).node.id;
    await convert(w, id, { docType: "PRC", ownerDepartmentId: finanzas.id });
    await edit(w, w.editor.token, id, "Texto original");
    const grant = await w.call("put", w.ws.token, `/nodes/${id}/permissions`, {
      membershipId: sergi.membership.id,
      level: "VIEW",
    });
    expect(grant.status).toBe(200);
    const comment = (token: string, body = "Revisar este punto") =>
      w.call("post", token, `/pages/${id}/comments`, { body, quote: "Texto" });
    return { w, id, sergi, comment };
  }
  type Round = {
    controlled: {
      status: string;
      review: { openComments: number; resolvedComments: number; hasPreviousReview: boolean } | null;
      versions: {
        status: string;
        approvals: {
          decision: string | null;
          commentCount: number;
          submittedBy: string | null;
          round: string;
        }[];
      }[];
    };
  };
  const roundOf = async (w: PagesWorld, token: string, id: string) =>
    (await w.call("get", token, `/nodes/${id}/controlled`)).body as Round;

  it("quien revisa comenta aunque solo vea el documento, pero no cambia el texto; solo durante la revisión", async () => {
    const { w, id, sergi, comment } = await inReview("Docs revisor comenta");
    // Fuera de la revisión, con solo lectura no puede comentar.
    expect((await comment(sergi.token)).status).toBe(403);
    expect((await submit(w, w.editor.token, id, [sergi.membership.id])).status).toBe(204);
    expect((await comment(sergi.token)).status).toBe(201);
    // Otra persona de solo lectura, que no revisa, sigue sin poder.
    expect((await comment(w.viewer.token)).status).toBe(403);
    // El revisor no edita el contenido, y el autor tampoco mientras se revisa.
    expect((await edit(w, sergi.token, id, "Cambio del revisor")).status).toBe(403);
    expect((await edit(w, w.editor.token, id, "Cambio del autor")).status).toBe(409);
    expect(await textOf(w, w.ws.token, id)).toContain("Texto original");
    // Al decidir, deja de revisar.
    expect((await decide(w, sergi.token, id, "APPROVED")).status).toBe(204);
    expect((await comment(sergi.token)).status).toBe(403);
  });

  it("pedir cambios: motivo obligatorio, vuelve a borrador con los comentarios abiertos, avisa al autor, y al reenviar se ve qué cambió desde su revisión", async () => {
    const { w, id, sergi, comment } = await inReview("Docs pedir cambios");
    await submit(w, w.editor.token, id, [sergi.membership.id]);
    await comment(sergi.token, "Falta citar la norma");
    await comment(sergi.token, "Aclarar el plazo");
    expect((await decide(w, sergi.token, id, "CHANGES_REQUESTED")).status).toBe(400);
    expect(
      (await decide(w, sergi.token, id, "CHANGES_REQUESTED", "Hay que completar dos puntos"))
        .status,
    ).toBe(204);
    expect((await roundOf(w, w.ws.token, id)).controlled.status).toBe("DRAFT");
    const open = await w.call("get", w.ws.token, `/pages/${id}/comments?status=open`);
    expect((open.body as { total: number }).total).toBe(2);
    const kinds = (
      (await w.call("get", w.editor.token, "/notifications")).body as { items: { kind: string }[] }
    ).items.map((item) => item.kind);
    expect(kinds).toContain("approval_changes");

    // Se corrige y se reenvía: el revisor ve lo que cambió desde su revisión y sus comentarios.
    expect((await edit(w, w.editor.token, id, "Texto corregido")).status).toBe(200);
    expect((await submit(w, w.editor.token, id, [sergi.membership.id])).status).toBe(204);
    const mine = (await roundOf(w, sergi.token, id)).controlled;
    expect(mine.review).toEqual({ openComments: 2, resolvedComments: 0, hasPreviousReview: true });
    const since = await w.call("get", sergi.token, `/nodes/${id}/controlled/compare?since=review`);
    expect(since.status).toBe(200);
    expect(since.body).toMatchObject({ stats: { changed: 1 } });
    // Quien no revisó antes no tiene esa comparación.
    expect(
      (await w.call("get", w.ws.token, `/nodes/${id}/controlled/compare?since=review`)).status,
    ).toBe(404);

    // Historial: dos rondas, con quién envió y cuántos comentarios dejó el revisor.
    const approvals = mine.versions[0]?.approvals ?? [];
    expect(approvals).toHaveLength(2);
    expect(approvals[0]).toMatchObject({
      decision: "CHANGES_REQUESTED",
      commentCount: 2,
      submittedBy: "Edith Editora",
    });
    expect(approvals[1]).toMatchObject({ decision: null, submittedBy: "Edith Editora" });
    expect(approvals[0]?.round).not.toBe(approvals[1]?.round);
  });

  it("rechazar descarta la versión: queda en el historial, el texto vuelve al de la vigente y se puede abrir una nueva", async () => {
    const w = await pagesWorld(ctx, "Docs rechazo");
    const { id, admin } = await publishedPage(w, "Texto vigente");
    await edit(w, w.editor.token, id, "Texto que se descarta");
    await submit(w, w.editor.token, id, [admin.membership.id]);
    expect((await decide(w, admin.token, id, "REJECTED")).status).toBe(400);
    expect(
      (await decide(w, admin.token, id, "REJECTED", "No corresponde a la política")).status,
    ).toBe(204);
    const view = (await roundOf(w, w.ws.token, id)).controlled;
    expect(view.status).toBe("REJECTED");
    expect(view.versions.map((v) => v.status)).toEqual(["REJECTED", "PUBLISHED"]);
    expect(await textOf(w, w.editor.token, id)).toContain("Texto vigente");
    expect(await textOf(w, w.editor.token, id)).not.toContain("se descarta");
    // La vigente sigue y editar abre la versión 3.
    expect(await textOf(w, w.viewer.token, id)).toContain("Texto vigente");
    expect((await edit(w, w.editor.token, id, "Texto nuevo")).status).toBe(200);
    expect((await roundOf(w, w.ws.token, id)).controlled.versions.map((v) => v.status)).toEqual([
      "DRAFT",
      "REJECTED",
      "PUBLISHED",
    ]);
  });
});

describe("candidatos a aprobador", () => {
  type Options = {
    suggested: { name: string; via: string; department: string | null; canView: boolean }[];
    others: { name: string; via: string; department: string | null; canView: boolean }[];
    department: { id: string; name: string } | null;
    canChangeDepartment: boolean;
    canGrantAccess: boolean;
  };
  const options = async (w: PagesWorld, token: string, id: string) =>
    (await w.call("get", token, `/nodes/${id}/controlled/approvers`)).body as Options;
  const all = (o: Options) => [...o.suggested, ...o.others];

  it("jefe y subjefe por cargo (también de un departamento padre), administradores y propietario; el autor, excluido", async () => {
    const w = await pagesWorld(ctx, "Docs candidatos");
    const finanzas = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Finanzas" },
    });
    const tesoreria = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Tesorería", parentId: finanzas.id },
    });
    const lead = async (departmentId: string, position: "HEAD" | "DEPUTY", name: string) => {
      const person = await addMember(ctx, w.ws, { name });
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.ws.workspaceId,
          departmentId,
          membershipId: person.membership.id,
          position,
        },
      });
      return person;
    };
    const head = await lead(finanzas.id, "HEAD", "Sergi Jefe");
    const deputy = await lead(tesoreria.id, "DEPUTY", "Dora Subjefa");
    const plain = await addMember(ctx, w.ws, { name: "Pablo Plano" });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: tesoreria.id,
        membershipId: plain.membership.id,
      },
    });
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Daniela Admin" });
    // El espacio es del departamento hijo: sus miembros, jefes y subjefes lo ven.
    await ctx.prisma.space.update({
      where: { id: w.spaceId },
      data: { departmentId: tesoreria.id },
    });
    const id = (await w.makePage()).node.id;
    await convert(w, id, { docType: "PRC", ownerDepartmentId: tesoreria.id });

    const seen = await options(w, w.editor.token, id);
    const by = (name: string) => all(seen).find((o) => o.name === name);
    expect(by("Sergi Jefe")).toMatchObject({ via: "head", department: "Finanzas" });
    expect(by("Dora Subjefa")).toMatchObject({ via: "deputy", department: "Tesorería" });
    expect(by("Daniela Admin")).toMatchObject({ via: "admin" });
    expect(by("Pablo Plano")).toBeUndefined();
    expect(seen.department?.name).toBe("Tesorería");
    expect(seen.canChangeDepartment).toBe(false);
    expect(seen.suggested.map((o) => o.name)).toEqual(["Dora Subjefa"]);
    expect(head.membership.id).not.toBe(deputy.membership.id);

    // El autor no figura salvo que se permita la autoaprobación.
    const mine = await options(w, admin.token, id);
    expect(all(mine).some((o) => o.name === "Daniela Admin")).toBe(false);
    await w.call("patch", w.ws.token, "/admin/security", { allowSelfApproval: true });
    expect(all(await options(w, admin.token, id)).some((o) => o.name === "Daniela Admin")).toBe(true);
    // Quien gestiona puede cambiar el departamento, y queda en la auditoría.
    const owner = await options(w, w.ws.token, id);
    expect(owner.canChangeDepartment).toBe(true);
    expect(
      (
        await w.call("patch", w.ws.token, `/nodes/${id}/controlled`, {
          ownerDepartmentId: finanzas.id,
        })
      ).status,
    ).toBe(204);
    expect((await options(w, w.ws.token, id)).department?.name).toBe("Finanzas");
    expect(
      (
        await w.call("patch", w.editor.token, `/nodes/${id}/controlled`, {
          ownerDepartmentId: null,
        })
      ).status,
    ).toBe(403);
  });

  it("jefe del departamento responsable sin acceso al espacio privado: aparece deshabilitado y se le puede dar acceso", async () => {
    const w = await pagesWorld(ctx, "Docs sin acceso");
    const finanzas = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Finanzas" },
    });
    const contabilidad = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Contabilidad", parentId: finanzas.id },
    });
    const head = async (departmentId: string, name: string) => {
      const person = await addMember(ctx, w.ws, { name });
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.ws.workspaceId,
          departmentId,
          membershipId: person.membership.id,
          position: "HEAD",
        },
      });
      return person;
    };
    const sergi = await head(finanzas.id, "Sergi Reich");
    await head(contabilidad.id, "Ana Belem");
    // Espacio privado de la empresa, sin departamento: los jefes no lo ven.
    await ctx.prisma.space.update({
      where: { id: w.spaceId },
      data: { isPrivate: true, departmentId: null },
    });
    const id = (await w.makePage()).node.id;
    await convert(w, id, { docType: "PRC", ownerDepartmentId: finanzas.id });

    // Responsable Finanzas: Sergi sale (sin acceso) y Ana, jefa de una subárea, no.
    let seen = await options(w, w.ws.token, id);
    const listed = (o: Options) => [...o.suggested, ...o.others];
    const sergiRow = listed(seen).find((o) => o.name === "Sergi Reich");
    expect(sergiRow).toMatchObject({ via: "head", department: "Finanzas", canView: false });
    expect(listed(seen).some((o) => o.name === "Ana Belem")).toBe(false);
    expect(seen.suggested.map((o) => o.name)).toEqual(["Sergi Reich"]);
    expect(seen.canGrantAccess).toBe(true);
    // Quien solo edita no puede dar acceso, y a Sergi no se le puede pedir todavía.
    expect((await options(w, w.editor.token, id)).canGrantAccess).toBe(false);
    expect((await submit(w, w.editor.token, id, [sergi.membership.id])).status).toBe(400);

    // Con acceso de lectura ya puede revisar.
    const give = await w.call("put", w.ws.token, `/nodes/${id}/permissions`, {
      membershipId: sergi.membership.id,
      level: "VIEW",
    });
    expect(give.status).toBe(200);
    seen = await options(w, w.ws.token, id);
    expect(listed(seen).find((o) => o.name === "Sergi Reich")?.canView).toBe(true);
    expect((await submit(w, w.editor.token, id, [sergi.membership.id])).status).toBe(204);
  });

  it("responsable de una subárea: sale su jefa y el de la superior; solo se sugiere a la jefa propia", async () => {
    const w = await pagesWorld(ctx, "Docs subárea");
    const finanzas = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Finanzas" },
    });
    const contabilidad = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Contabilidad", parentId: finanzas.id },
    });
    for (const [departmentId, name] of [
      [finanzas.id, "Sergi Reich"],
      [contabilidad.id, "Ana Belem"],
    ] as const) {
      const person = await addMember(ctx, w.ws, { name });
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.ws.workspaceId,
          departmentId,
          membershipId: person.membership.id,
          position: "HEAD",
        },
      });
    }
    const id = (await w.makePage()).node.id;
    await convert(w, id, { docType: "PRC", ownerDepartmentId: contabilidad.id });
    const seen = await options(w, w.ws.token, id);
    expect([...seen.suggested, ...seen.others].map((o) => o.name)).toEqual(
      expect.arrayContaining(["Ana Belem", "Sergi Reich"]),
    );
    expect(seen.suggested.map((o) => o.name)).toEqual(["Ana Belem"]);
  });

  it("sin departamento responsable igual aparecen propietario y administradores", async () => {
    const w = await pagesWorld(ctx, "Docs sin depto");
    await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Admin" });
    const id = (await w.makePage()).node.id;
    await ctx.prisma.space.update({ where: { id: w.spaceId }, data: { departmentId: null } });
    await convert(w, id, { docType: "PRC", ownerDepartmentId: null });
    const seen = await options(w, w.editor.token, id);
    expect(seen.department).toBeNull();
    expect(seen.suggested).toEqual([]);
    expect(all(seen).map((o) => o.via)).toEqual(expect.arrayContaining(["admin"]));
  });
});

describe("una sola versión vigente", () => {
  it("editar un publicado abre un borrador; quien solo lee sigue viendo la vigente; la anterior queda obsoleta", async () => {
    const w = await pagesWorld(ctx, "Docs vigente");
    const { id, admin } = await publishedPage(w, "Versión uno");
    expect(await textOf(w, w.viewer.token, id)).toContain("Versión uno");

    expect((await edit(w, w.editor.token, id, "Versión dos en borrador")).status).toBe(200);
    expect((await infoOf(w, w.ws.token, id)).controlled).toMatchObject({
      status: "DRAFT",
      publishedVersion: 1,
    });
    // El que no edita ve la vigente; el que edita, su borrador.
    expect(await textOf(w, w.viewer.token, id)).toContain("Versión uno");
    expect(await textOf(w, w.viewer.token, id)).not.toContain("borrador");
    expect(await textOf(w, w.editor.token, id)).toContain("Versión dos en borrador");

    await submit(w, w.editor.token, id, [admin.membership.id]);
    await decide(w, admin.token, id, "APPROVED");
    expect((await publish(w, admin.token, id)).status).toBe(204);
    const versions = (await infoOf(w, w.ws.token, id)).controlled?.versions.map((v) => [
      v.version,
      v.status,
    ]);
    expect(versions).toEqual([
      [2, "PUBLISHED"],
      [1, "OBSOLETE"],
    ]);
    expect(
      await ctx.prisma.documentVersion.count({ where: { nodeId: id, status: "PUBLISHED" } }),
    ).toBe(1);
    expect(await textOf(w, w.viewer.token, id)).toContain("Versión dos en borrador");
  });
});

describe("lecturas obligatorias", () => {
  it("solo con permiso, solo de lo publicado, y «Leí y comprendo» solo propio y por versión", async () => {
    const w = await pagesWorld(ctx, "Docs lecturas");
    const dept = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Planta" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: dept.id,
        membershipId: w.viewer.membership.id,
      },
    });
    const draft = (await w.makePage()).node.id;
    await convert(w, draft);
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Admin" });
    // Sin versión publicada no se pide lectura.
    expect(
      (
        await w.call("put", admin.token, `/nodes/${draft}/controlled/readings`, {
          departmentId: dept.id,
        })
      ).status,
    ).toBe(409);

    const { id, admin: approver } = await publishedPage(w, "Instrucción");
    const ask = (token: string, body: object) =>
      w.call("put", token, `/nodes/${id}/controlled/readings`, body);
    expect((await ask(w.editor.token, { departmentId: dept.id })).status).toBe(403);
    expect((await ask(w.outsider.token, { departmentId: dept.id })).status).toBe(404);
    expect((await ask(approver.token, {})).status).toBe(400);
    expect((await ask(approver.token, { departmentId: dept.id })).status).toBe(204);

    // Nadie lee ni ve el cumplimiento sin permiso.
    expect((await w.call("get", w.editor.token, `/nodes/${id}/controlled/readings`)).status).toBe(
      403,
    );
    // Quien no debe leerlo no puede confirmar; quien sí, solo por sí mismo y una vez.
    const ack = (token: string) => w.call("post", token, `/nodes/${id}/controlled/acknowledge`);
    expect((await ack(w.commenter.token)).status).toBe(403);
    expect((await ack(w.viewer.token)).status).toBe(204);
    expect((await ack(w.viewer.token)).status).toBe(204);
    expect(
      await ctx.prisma.readAcknowledgment.count({
        where: { nodeId: id, membershipId: w.viewer.membership.id },
      }),
    ).toBe(1);
    // Sus pendientes son solo las suyas.
    const mine = async (token: string) =>
      (await w.call("get", token, "/documents/readings")).body as { total: number };
    expect((await mine(w.viewer.token)).total).toBe(0);
    expect((await mine(w.commenter.token)).total).toBe(0);

    // Una versión nueva hay que leerla otra vez.
    await edit(w, w.editor.token, id, "Instrucción corregida");
    await submit(w, w.editor.token, id, [approver.membership.id]);
    await decide(w, approver.token, id, "APPROVED");
    await publish(w, approver.token, id);
    expect((await mine(w.viewer.token)).total).toBe(1);
    expect((await ack(w.viewer.token)).status).toBe(204);
    expect((await mine(w.viewer.token)).total).toBe(0);
    const overview = await w.call("get", approver.token, `/nodes/${id}/controlled/readings`);
    expect(overview.body).toMatchObject({ version: 2, summary: { total: 1, read: 1 } });
  });
});

describe("nuevas versiones y relectura", () => {
  type Mine = {
    controlled: {
      reading: {
        mine: {
          required: boolean;
          acknowledged: boolean;
          readVersion: number | null;
          changeReason: string | null;
        } | null;
      };
      versions: { version: number; minorChange: boolean; changeReason: string | null }[];
    };
  };

  /** Documento publicado (v1) con lectura pedida a Planta, donde está la visora, que ya lo leyó. */
  async function readByViewer() {
    const w = await pagesWorld(ctx, "Docs relectura");
    const dept = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Planta" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: dept.id,
        membershipId: w.viewer.membership.id,
      },
    });
    const { id, admin } = await publishedPage(w, "Versión uno");
    await w.call("put", admin.token, `/nodes/${id}/controlled/readings`, { departmentId: dept.id });
    expect(
      (await w.call("post", w.viewer.token, `/nodes/${id}/controlled/acknowledge`)).status,
    ).toBe(204);
    return { w, id, admin };
  }

  const releaseV2 = async (
    w: PagesWorld,
    id: string,
    admin: { token: string; membership: { id: string } },
    body: object,
  ) => {
    await edit(w, w.editor.token, id, "Versión dos");
    await submit(w, w.editor.token, id, [admin.membership.id]);
    await decide(w, admin.token, id, "APPROVED");
    expect(
      (await w.call("post", admin.token, `/nodes/${id}/controlled/publish`, body)).status,
    ).toBe(204);
  };
  const mineOf = async (w: PagesWorld, id: string) =>
    ((await w.call("get", w.viewer.token, `/nodes/${id}/controlled`)).body as Mine).controlled;
  const pending = async (w: PagesWorld) =>
    ((await w.call("get", w.viewer.token, "/documents/readings")).body as { total: number }).total;

  it("por defecto se pide nueva lectura: la de v1 no cuenta para v2 y se ve el motivo y desde qué versión", async () => {
    const { w, id, admin } = await readByViewer();
    expect(await pending(w)).toBe(0);
    await releaseV2(w, id, admin, { reason: "Se agregó el paso de lavado" });
    expect(await pending(w)).toBe(1);
    const view = await mineOf(w, id);
    expect(view.reading.mine).toMatchObject({
      required: true,
      acknowledged: false,
      readVersion: 1,
      changeReason: "Se agregó el paso de lavado",
    });
    expect(view.versions[0]).toMatchObject({ version: 2, minorChange: false });
    expect(
      (await w.call("post", w.viewer.token, `/nodes/${id}/controlled/acknowledge`)).status,
    ).toBe(204);
    expect(await pending(w)).toBe(0);
  });

  it("cambio menor: las lecturas anteriores siguen valiendo y queda registrado", async () => {
    const { w, id, admin } = await readByViewer();
    await releaseV2(w, id, admin, { requestReading: false, reason: "Corrección de ortografía" });
    expect(await pending(w)).toBe(0);
    const view = await mineOf(w, id);
    expect(view.reading.mine).toMatchObject({ required: true, acknowledged: true });
    expect(view.versions[0]).toMatchObject({
      version: 2,
      minorChange: true,
      changeReason: "Corrección de ortografía",
    });
    const overview = await w.call("get", admin.token, `/nodes/${id}/controlled/readings`);
    expect(overview.body).toMatchObject({ version: 2, summary: { total: 1, read: 1, pending: 0 } });
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "document.published", entityId: id },
      }),
    ).toBe(2);
  });
});

describe("lectura pedida a quienes no ven el documento", () => {
  type Gaps = { total: number; people: { name: string }[]; canGrant: boolean };
  type Overview = {
    summary: { total: number; read: number; pending: number; overdue: number; noAccess: number };
  };

  it("avisa quiénes no tienen acceso, cuenta el total y les da acceso de lectura con el mismo alcance", async () => {
    const w = await pagesWorld(ctx, "Docs lectura sin acceso");
    const backOffice = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Back Office" },
    });
    for (const name of ["Uno Oficina", "Dos Oficina", "Tres Oficina"]) {
      const person = await addMember(ctx, w.ws, { name });
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.ws.workspaceId,
          departmentId: backOffice.id,
          membershipId: person.membership.id,
        },
      });
    }
    // Espacio privado sin departamento: Back Office no entra.
    await ctx.prisma.space.update({
      where: { id: w.spaceId },
      data: { isPrivate: true, departmentId: null },
    });
    const { id } = await publishedPage(w, "Manual de apps");
    const base = `/nodes/${id}/controlled/readings`;

    // Antes de pedirla: el diálogo sabe que son 3 y que quien gestiona puede darles acceso.
    const preview = (token: string) =>
      w.call(
        "get",
        token,
        `${base}/access-gaps?departmentId=${backOffice.id}&includeSubareas=false`,
      );
    expect((await preview(w.editor.token)).status).toBe(403);
    const gaps = (await preview(w.ws.token)).body as Gaps;
    expect(gaps.total).toBe(3);
    expect(gaps.canGrant).toBe(true);
    expect(gaps.people.map((p) => p.name)).toEqual(["Dos Oficina", "Tres Oficina", "Uno Oficina"]);

    // Se pide igual, y el resumen suma siempre el total: nadie queda contado a medias.
    expect((await w.call("put", w.ws.token, base, { departmentId: backOffice.id })).status).toBe(
      204,
    );
    const overview = async () => (await w.call("get", w.ws.token, base)).body as Overview;
    expect((await overview()).summary).toEqual({
      total: 3,
      read: 0,
      pending: 0,
      overdue: 0,
      noAccess: 3,
    });
    // Sin acceso no hay nadie a quien recordar.
    expect((await w.call("post", w.ws.token, `${base}/remind`, {})).body).toEqual({ sent: 0 });

    // Darles acceso: solo quien gestiona; queda en la auditoría.
    expect((await w.call("post", w.editor.token, `${base}/grant-access`, {})).status).toBe(403);
    expect((await w.call("post", w.ws.token, `${base}/grant-access`, {})).status).toBe(204);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "permission.set", entityId: id },
      }),
    ).toBeGreaterThan(0);
    expect(
      await ctx.prisma.permission.count({
        where: { nodeId: id, departmentId: backOffice.id, level: "VIEW" },
      }),
    ).toBe(1);
    expect(((await preview(w.ws.token)).body as Gaps).total).toBe(0);
    const after = (await overview()).summary;
    expect(after).toMatchObject({ total: 3, pending: 3, noAccess: 0, read: 0 });
    expect(after.read + after.pending + after.overdue + after.noAccess).toBe(after.total);

    // Recordatorio manual: una vez por persona y por día.
    expect((await w.call("post", w.ws.token, `${base}/remind`, {})).body).toEqual({ sent: 3 });
    expect((await w.call("post", w.ws.token, `${base}/remind`, {})).body).toEqual({ sent: 0 });
    expect((await w.call("post", w.editor.token, `${base}/remind`, {})).status).toBe(403);
  });
});

describe("recientes, avisos y panel", () => {
  it("los recientes son privados y se conservan 50 por persona", async () => {
    const w = await pagesWorld(ctx, "Docs recientes");
    const ids: string[] = [];
    for (let index = 0; index < 52; index += 1) ids.push((await w.makePage()).node.id);
    for (const id of ids) await w.call("get", w.viewer.token, `/pages/${id}`);
    const recent = async (token: string) =>
      (await w.call("get", token, "/documents/recent?pageSize=20")).body as {
        total: number;
        items: { node: { id: string } }[];
      };
    const mine = await recent(w.viewer.token);
    expect(mine.total).toBe(50);
    expect(mine.items[0]?.node.id).toBe(ids.at(-1));
    expect(
      await ctx.prisma.documentVisit.count({ where: { membershipId: w.viewer.membership.id } }),
    ).toBe(50);
    // Nadie ve los de otra persona.
    expect((await recent(w.editor.token)).total).toBe(0);
    expect((await recent(w.stranger.token)).total).toBe(0);
  }, 120_000);

  it("el aviso de aprobación pendiente es solo de quien debe aprobar", async () => {
    const w = await pagesWorld(ctx, "Docs avisos");
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Admin" });
    const id = (await w.makePage()).node.id;
    await convert(w, id);
    await submit(w, w.editor.token, id, [admin.membership.id]);
    const unread = async (token: string) =>
      (
        (await w.call("get", token, "/notifications")).body as { items: { kind: string }[] }
      ).items.map((i) => i.kind);
    expect(await unread(admin.token)).toEqual(["approval_pending"]);
    expect(await unread(w.editor.token)).toEqual([]);
    expect(await unread(w.viewer.token)).toEqual([]);
  });

  it("el panel de documentos: solo con permiso; un jefe ve su área; numeración solo con ajustes", async () => {
    const w = await pagesWorld(ctx, "Docs panel");
    const compras = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Compras" },
    });
    const calidad = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Calidad" },
    });
    const head = await addMember(ctx, w.ws, { name: "Hugo Jefe" });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: compras.id,
        membershipId: head.membership.id,
        position: "HEAD",
      },
    });
    const one = (await w.makePage()).node.id;
    const two = (await w.makePage()).node.id;
    await convert(w, one, { docType: "PRC", ownerDepartmentId: compras.id });
    await convert(w, two, { docType: "INS", ownerDepartmentId: calidad.id });

    const list = async (token: string) =>
      (await w.call("get", token, "/admin/documents")).body as { items: { code: string }[] };
    expect((await w.call("get", w.viewer.token, "/admin/documents")).status).toBe(403);
    expect((await list(w.ws.token)).items.map((i) => i.code).sort()).toEqual([
      "INS-001",
      "PRC-001",
    ]);
    expect((await list(head.token)).items.map((i) => i.code)).toEqual(["PRC-001"]);

    const types = (path: string, method: "get" | "post" | "patch", token: string, body?: object) =>
      w.call(method, token, path, body);
    expect((await types("/admin/documents/types", "get", head.token)).status).toBe(200);
    expect(
      (await types("/admin/documents/types", "post", head.token, { code: "ZZZ", name: "Nuevo" }))
        .status,
    ).toBe(403);
    expect(
      (await types("/admin/documents/types", "post", w.ws.token, { code: "ZZZ", name: "Nuevo" }))
        .status,
    ).toBe(201);
    expect(
      (await types("/admin/documents/types", "post", w.ws.token, { code: "ZZZ", name: "Otra vez" }))
        .status,
    ).toBe(409);
    // El contador solo sube.
    expect(
      (await types("/admin/documents/types/PRC", "patch", w.ws.token, { nextNumber: 1 })).status,
    ).toBe(400);
    expect(
      (await types("/admin/documents/types/PRC", "patch", w.ws.token, { nextNumber: 50 })).status,
    ).toBe(200);
  });
});

describe("PDF y comparación", () => {
  it("el PDF controlado respeta el acceso y solo existe para lo publicado", async () => {
    const w = await pagesWorld(ctx, "Docs pdf");
    const id = (await w.makePage()).node.id;
    await convert(w, id);
    const pdf = (token: string) => w.call("get", token, `/nodes/${id}/controlled/pdf`);
    expect((await pdf(w.ws.token)).status).toBe(409);
    expect((await pdf(w.stranger.token)).status).toBe(404);
    expect((await pdf(w.outsider.token)).status).toBe(404);
  });

  it("las versiones en borrador solo las compara quien edita o aprueba", async () => {
    const w = await pagesWorld(ctx, "Docs comparar");
    const { id } = await publishedPage(w, "Antes");
    await edit(w, w.editor.token, id, "Después");
    const compare = (token: string) => w.call("get", token, `/nodes/${id}/controlled/compare`);
    const result = await compare(w.editor.token);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ stats: { changed: 1 } });
    expect((await compare(w.viewer.token)).status).toBe(403);
    expect((await compare(w.stranger.token)).status).toBe(404);
  });
});
