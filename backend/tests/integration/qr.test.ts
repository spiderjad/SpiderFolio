// Códigos QR de documentos: quién los genera, que uno revocado no abre, que el público abre solo ese
// documento y que ninguna empresa ve los de otra.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, paragraph, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface Qr {
  id: string;
  isPublic: boolean;
  url: string;
  scans: number;
  revokedAt: string | null;
}

const tokenOf = (qr: Qr): string => qr.url.slice(qr.url.lastIndexOf("/") + 1);

async function pageWith(w: PagesWorld, text: string): Promise<string> {
  const id = (await w.makePage()).node.id;
  const page = (await w.call("get", w.ws.token, `/pages/${id}`)).body as {
    page: { revision: number };
  };
  expect((await w.save(w.ws.token, id, page.page.revision, doc(paragraph(text)))).status).toBe(200);
  return id;
}

const scan = (token: string, bearer?: string) => {
  const call = request(createApp(ctx.deps)).get(`/api/v1/qr/${token}`);
  return bearer === undefined ? call : call.set("Authorization", `Bearer ${bearer}`);
};

describe("generar y revocar", () => {
  it("quien edita genera; quien solo lee o no ve, no; carpetas no", async () => {
    const w = await pagesWorld(ctx, "QR generar");
    const id = await pageWith(w, "Instructivo");
    expect((await w.call("post", w.viewer.token, `/nodes/${id}/qr`, {})).status).toBe(403);
    expect((await w.call("post", w.stranger.token, `/nodes/${id}/qr`, {})).status).toBe(404);
    expect((await w.call("post", w.outsider.token, `/nodes/${id}/qr`, {})).status).toBe(404);
    const folder = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, {
      name: "Carpeta",
    });
    const folderId = (folder.body as { node: { id: string } }).node.id;
    expect((await w.call("post", w.ws.token, `/nodes/${folderId}/qr`, {})).status).toBe(400);

    const created = await w.call("post", w.editor.token, `/nodes/${id}/qr`, {});
    expect(created.status).toBe(201);
    const qr = created.body as Qr;
    expect(qr).toMatchObject({ isPublic: false, scans: 0, revokedAt: null });
    expect(qr.url).toMatch(/\/q\/[\w-]{20,}$/u);
    const list = await w.call("get", w.editor.token, `/nodes/${id}/qr`);
    expect((list.body as { items: Qr[] }).items.map((item) => item.id)).toEqual([qr.id]);
    expect((await w.call("get", w.viewer.token, `/nodes/${id}/qr`)).status).toBe(403);

    // La imagen y las etiquetas se descargan (y quedan sin caché).
    const png = await w.call("get", w.editor.token, `/qr/${qr.id}/image?format=png`);
    expect(png.status).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    const svg = await w.call("get", w.editor.token, `/qr/${qr.id}/image?format=svg`);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    const labels = await w.call("get", w.editor.token, `/qr/${qr.id}/labels?size=small`);
    expect(labels.status).toBe(200);
    expect(labels.headers["content-type"]).toBe("application/pdf");
    expect((await w.call("get", w.viewer.token, `/qr/${qr.id}/image`)).status).toBe(403);
    expect((await w.call("get", w.outsider.token, `/qr/${qr.id}/image`)).status).toBe(404);
    expect((await w.call("get", w.editor.token, `/qr/${qr.id}/labels?size=enorme`)).status).toBe(
      400,
    );
  });

  it("un QR revocado no abre, ni el privado ni el público", async () => {
    const w = await pagesWorld(ctx, "QR revocado");
    const id = await pageWith(w, "Texto");
    const priv = (await w.call("post", w.editor.token, `/nodes/${id}/qr`, {})).body as Qr;
    const pub = (await w.call("post", w.ws.token, `/nodes/${id}/qr`, { public: true })).body as Qr;
    expect((await scan(tokenOf(priv), w.viewer.token)).status).toBe(200);
    expect((await scan(tokenOf(pub))).status).toBe(200);
    // Revocar: quien lo generó o quien gestiona; otra persona que edita no.
    expect((await w.call("delete", w.viewer.token, `/qr/${priv.id}`)).status).toBe(403);
    expect((await w.call("delete", w.editor.token, `/qr/${priv.id}`)).status).toBe(204);
    expect((await w.call("delete", w.editor.token, `/qr/${pub.id}`)).status).toBe(403);
    expect((await w.call("delete", w.ws.token, `/qr/${pub.id}`)).status).toBe(204);
    expect((await scan(tokenOf(priv), w.viewer.token)).status).toBe(404);
    expect((await scan(tokenOf(pub))).status).toBe(404);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "qr.revoke" },
      }),
    ).toBe(2);
  });
});

describe("escanear un QR privado", () => {
  it("pide sesión y que la persona vea el documento; cuenta solo los escaneos que abren", async () => {
    const w = await pagesWorld(ctx, "QR privado");
    const id = await pageWith(w, "Solo para el personal");
    const qr = (await w.call("post", w.editor.token, `/nodes/${id}/qr`, {})).body as Qr;
    const token = tokenOf(qr);

    expect((await scan(token)).status).toBe(401);
    // Sin acceso al documento o de otra empresa: un 404 que no dice si existe.
    expect((await scan(token, w.stranger.token)).status).toBe(404);
    expect((await scan(token, w.outsider.token)).status).toBe(404);
    const ok = await scan(token, w.viewer.token);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      kind: "private",
      nodeId: id,
      spaceId: w.spaceId,
      nodeType: "PAGE",
    });
    // Nada del contenido en la respuesta: la persona va al documento y ahí rige su permiso.
    expect(JSON.stringify(ok.body)).not.toContain("Solo para el personal");
    expect((await scan("x".repeat(22), w.viewer.token)).status).toBe(404);

    const list = await w.call("get", w.editor.token, `/nodes/${id}/qr`);
    expect((list.body as { items: Qr[] }).items[0]?.scans).toBe(1);
  });
});

describe("QR público", () => {
  it("solo con permiso: quien gestiona y tiene la capacidad", async () => {
    const w = await pagesWorld(ctx, "QR público permisos");
    const id = await pageWith(w, "Normas para contratistas");
    // Quien solo edita no puede abrir el documento al público.
    expect((await w.call("post", w.editor.token, `/nodes/${id}/qr`, { public: true })).status).toBe(
      403,
    );
    const created = await w.call("post", w.ws.token, `/nodes/${id}/qr`, { public: true });
    expect(created.status).toBe(201);
    expect((created.body as Qr).isPublic).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "qr.create", entityId: id },
      }),
    ).toBe(1);
    const list = await w.call("get", w.ws.token, `/nodes/${id}/qr`);
    expect((list.body as { canPublic: boolean }).canPublic).toBe(true);
    expect(
      ((await w.call("get", w.editor.token, `/nodes/${id}/qr`)).body as { canPublic: boolean })
        .canPublic,
    ).toBe(false);
  });

  it("abre sin sesión únicamente ese documento y cuenta sin guardar datos de quien escanea", async () => {
    const w = await pagesWorld(ctx, "QR público abre");
    const shown = await pageWith(w, "Reglas de seguridad para contratistas");
    const hidden = await pageWith(w, "Secreto de la otra página");
    const qr = (await w.call("post", w.ws.token, `/nodes/${shown}/qr`, { public: true }))
      .body as Qr;

    const res = await scan(tokenOf(qr));
    expect(res.status).toBe(200);
    const body = res.body as { kind: string; title: string; html: string };
    expect(body.kind).toBe("public-page");
    expect(body.html).toContain("Reglas de seguridad para contratistas");
    // Nada de la otra página, ni sus ids, ni los del espacio o la empresa.
    const serialized = JSON.stringify(res.body);
    for (const secret of ["Secreto de la otra página", hidden, w.spaceId, w.ws.workspaceId]) {
      expect(serialized).not.toContain(secret);
    }
    // El token de un documento no sirve para otro: no hay forma de pedir otro nodo.
    expect((await scan(`${tokenOf(qr)}x`)).status).toBe(404);
    expect((await scan(hidden)).status).toBe(404);

    expect((await scan(tokenOf(qr))).status).toBe(200);
    const row = await ctx.prisma.qrCode.findUniqueOrThrow({ where: { id: qr.id } });
    expect(row.scans).toBe(2);
    // El contador es un número: ninguna columna guarda quién o desde dónde.
    expect(Object.keys(row).sort()).toEqual(
      [
        "createdAt",
        "createdById",
        "id",
        "isPublic",
        "lastScanAt",
        "nodeId",
        "revokedAt",
        "scans",
        "token",
        "workspaceId",
      ].sort(),
    );
  });

  it("muestra la versión vigente de un documento controlado, no el borrador", async () => {
    const w = await pagesWorld(ctx, "QR vigente");
    const id = await pageWith(w, "Versión vigente");
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Aprueba" });
    expect(
      (await w.call("post", w.ws.token, `/nodes/${id}/controlled`, { docType: "PRC" })).status,
    ).toBe(201);
    const qr = (await w.call("post", w.ws.token, `/nodes/${id}/qr`, { public: true })).body as Qr;
    // Todavía no hay versión vigente: no se abre.
    expect((await scan(tokenOf(qr))).status).toBe(404);
    const flow = (action: string, token: string, body: object = {}) =>
      w.call("post", token, `/nodes/${id}/controlled/${action}`, body);
    expect((await flow("submit", w.ws.token, { approverIds: [admin.membership.id] })).status).toBe(
      204,
    );
    expect((await flow("decision", admin.token, { decision: "APPROVED" })).status).toBe(204);
    expect((await flow("publish", admin.token)).status).toBe(204);
    expect(((await scan(tokenOf(qr))).body as { html: string }).html).toContain("Versión vigente");

    // Un borrador nuevo no se ve hasta que se publique.
    const page = (await w.call("get", w.ws.token, `/pages/${id}`)).body as {
      page: { revision: number };
    };
    expect(
      (await w.save(w.ws.token, id, page.page.revision, doc(paragraph("Borrador nuevo")))).status,
    ).toBe(200);
    const after = (await scan(tokenOf(qr))).body as { html: string };
    expect(after.html).toContain("Versión vigente");
    expect(after.html).not.toContain("Borrador nuevo");
  });

  it("el QR público lo crea quien tiene content.public_qr, sin depender de un plan", async () => {
    const w = await pagesWorld(ctx, "QR sin plan");
    const id = await pageWith(w, "Texto");
    const qr = (await w.call("post", w.ws.token, `/nodes/${id}/qr`, { public: true })).body as Qr;
    expect((await scan(tokenOf(qr))).status).toBe(200);
    expect(
      ((await w.call("get", w.ws.token, `/nodes/${id}/qr`)).body as { canPublic: boolean })
        .canPublic,
    ).toBe(true);
  });
});

describe("aislamiento entre empresas", () => {
  it("el QR de una empresa no se lista, descarga ni revoca desde otra", async () => {
    const w = await pagesWorld(ctx, "QR aislamiento");
    const id = await pageWith(w, "Texto");
    const qr = (await w.call("post", w.ws.token, `/nodes/${id}/qr`, {})).body as Qr;
    const intruder = w.outsider;
    for (const [method, path] of [
      ["get", `/nodes/${id}/qr`],
      ["post", `/nodes/${id}/qr`],
      ["get", `/qr/${qr.id}/image`],
      ["get", `/qr/${qr.id}/labels`],
      ["delete", `/qr/${qr.id}`],
    ] as const) {
      const res = await w.call(method, intruder.token, path, undefined, intruder.slug);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(
      (await ctx.prisma.qrCode.findUniqueOrThrow({ where: { id: qr.id } })).revokedAt,
    ).toBeNull();
  });
});
