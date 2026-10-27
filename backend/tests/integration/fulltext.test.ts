// Búsqueda de texto completo: contenido de páginas, PDF y DOCX; sin acentos ni plurales; con la palabra
// resaltada; solo lo que la persona ve; y nada de otra empresa.
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipStream } from "../../src/modules/nodes/zip-writer.ts";
import { extractFileText, reindexSearch } from "../../src/modules/search/search-jobs.ts";
import { DOCX_MIME, PDF_MIME } from "../../src/modules/search/text-extract.ts";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, paragraph, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface Segment {
  text: string;
  match: boolean;
}
interface Hit {
  id: string;
  type: string;
  name: Segment[];
  snippet: Segment[];
  code: string | null;
  spaceName: string;
}
interface Result {
  items: Hit[];
  nextCursor: string | null;
}

const plain = (segments: Segment[]) => segments.map((s) => s.text).join("");
const marked = (segments: Segment[]) => segments.filter((s) => s.match).map((s) => s.text);

const search = async (w: PagesWorld, token: string, q: string, extra = "", slug = w.ws.slug) => {
  const res = await w.call(
    "get",
    token,
    `/search?q=${encodeURIComponent(q)}${extra}`,
    undefined,
    slug,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Result;
};

async function pageWith(w: PagesWorld, name: string, text: string): Promise<string> {
  const id = (await w.makePage()).node.id;
  expect((await w.call("patch", w.ws.token, `/nodes/${id}`, { name })).status).toBe(200);
  const page = (await w.call("get", w.ws.token, `/pages/${id}`)).body as {
    page: { revision: number };
  };
  expect((await w.save(w.ws.token, id, page.page.revision, doc(paragraph(text)))).status).toBe(200);
  return id;
}

describe("buscar en el contenido", () => {
  it("encuentra sin acentos ni plurales, resalta la palabra y ordena por relevancia", async () => {
    const w = await pagesWorld(ctx, "FTS contenido");
    const body = await pageWith(
      w,
      "Instructivo de planta",
      "Antes de empezar hay que revisar las máquinas y registrar la temperatura del agua.",
    );
    const title = await pageWith(w, "Revisión de máquinas", "Se hace una vez por semana.");
    const none = await pageWith(w, "Otra cosa", "Sin relación con el tema.");

    const found = await search(w, w.editor.token, "maquina");
    // El título pesa más que el cuerpo.
    expect(found.items.map((hit) => hit.id)).toEqual([title, body]);
    expect(found.items.map((hit) => hit.id)).not.toContain(none);
    const hit = found.items[1];
    expect(hit?.snippet.some((s) => s.match)).toBe(true);
    expect(marked(hit?.snippet ?? [])[0]?.toLowerCase()).toBe("máquinas");
    expect(plain(hit?.snippet ?? [])).toContain("registrar la temperatura");
    expect(marked(found.items[0]?.name ?? [])[0]?.toLowerCase()).toBe("máquinas");
    expect(found.items[0]).toMatchObject({ spaceName: "Calidad", type: "PAGE" });
    // Frases entre comillas, exclusiones y varias palabras.
    expect(
      (await search(w, w.editor.token, '"temperatura del agua"')).items.map((h) => h.id),
    ).toEqual([body]);
    expect((await search(w, w.editor.token, "maquinas -semana")).items.map((h) => h.id)).toEqual([
      body,
    ]);
    expect((await search(w, w.editor.token, "xyzinexistente")).items).toEqual([]);
  });

  it("busca por código de documento controlado y por texto en la versión vigente, no en el borrador", async () => {
    const w = await pagesWorld(ctx, "FTS controlado");
    const id = await pageWith(w, "Higiene del personal", "Versión vigente: lavarse las manos.");
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Aprueba" });
    expect(
      (await w.call("post", w.ws.token, `/nodes/${id}/controlled`, { docType: "PRC" })).status,
    ).toBe(201);
    expect((await search(w, w.viewer.token, "PRC-001")).items.map((h) => h.id)).toEqual([id]);
    const flow = (action: string, token: string, body: object = {}) =>
      w.call("post", token, `/nodes/${id}/controlled/${action}`, body);
    await flow("submit", w.ws.token, { approverIds: [admin.membership.id] });
    await flow("decision", admin.token, { decision: "APPROVED" });
    expect((await flow("publish", admin.token)).status).toBe(204);

    // Un borrador nuevo con otro texto: quien solo lee no lo puede encontrar.
    const page = (await w.call("get", w.ws.token, `/pages/${id}`)).body as {
      page: { revision: number };
    };
    await w.save(
      w.ws.token,
      id,
      page.page.revision,
      doc(paragraph("Borrador reservado: usar guantes azules.")),
    );
    expect((await search(w, w.viewer.token, "guantes")).items).toEqual([]);
    expect((await search(w, w.viewer.token, "manos")).items.map((h) => h.id)).toEqual([id]);
  });

  it("solo devuelve lo que la persona ve: ni el título, ni lo de otra empresa", async () => {
    const w = await pagesWorld(ctx, "FTS permisos");
    await pageWith(
      w,
      "Plan reservado de despidos",
      "Cronograma de la reestructuración confidencial.",
    );
    expect(await search(w, w.stranger.token, "reestructuración")).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(JSON.stringify(await search(w, w.stranger.token, "despidos"))).not.toContain("despidos");
    expect((await search(w, w.viewer.token, "reestructuración")).items).toHaveLength(1);

    // Compartido solo una carpeta: la persona encuentra lo de adentro y nada más.
    const folder = (
      await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, {
        name: "Carpeta compartida",
      })
    ).body as { node: { id: string } };
    const inside = (await w.makePage(w.ws.token, { parentId: folder.node.id })).node.id;
    const page = (await w.call("get", w.ws.token, `/pages/${inside}`)).body as {
      page: { revision: number };
    };
    await w.save(
      w.ws.token,
      inside,
      page.page.revision,
      doc(paragraph("Cronograma de auditoría interna.")),
    );
    const guest = await addMember(ctx, w.ws, { name: "Gabi Compartida" });
    expect((await search(w, guest.token, "cronograma")).items).toEqual([]);
    await w.call("put", w.ws.token, `/nodes/${folder.node.id}/permissions`, {
      membershipId: guest.membership.id,
      level: "VIEW",
    });
    expect((await search(w, guest.token, "cronograma")).items.map((h) => h.id)).toEqual([inside]);

    // Otra empresa con el mismo texto: cada una ve solo lo suyo.
    const other = w.outsider;
    const space = await w.call(
      "post",
      other.token,
      "/spaces",
      { name: "Ajeno", isPrivate: false },
      other.slug,
    );
    const spaceId = (space.body as { space: { id: string } }).space.id;
    const created = await w.call("post", other.token, `/spaces/${spaceId}/pages`, {}, other.slug);
    const otherId = (created.body as { page: { node: { id: string }; revision: number } }).page.node
      .id;
    await w.call(
      "patch",
      other.token,
      `/nodes/${otherId}`,
      { name: "Cronograma ajeno" },
      other.slug,
    );
    const theirs = await search(w, other.token, "cronograma", "", other.slug);
    expect(theirs.items.map((h) => plain(h.name))).toEqual(["Cronograma ajeno"]);
    const mine = JSON.stringify(await search(w, w.ws.token, "cronograma"));
    expect(mine).not.toContain("ajeno");
  });

  it("pagina por cursor sin repetir ni perder resultados", async () => {
    const w = await pagesWorld(ctx, "FTS paginación");
    const ids: string[] = [];
    for (let index = 0; index < 23; index += 1) {
      ids.push(
        await pageWith(w, `Norma ${String(index)}`, "El protocolo de calibración aplica a todo."),
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor === null ? "&pageSize=10" : `&pageSize=10&cursor=${cursor}`;
      const page = await search(w, w.ws.token, "calibración", query);
      seen.push(...page.items.map((h) => h.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 6);
    expect(new Set(seen).size).toBe(23);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(pages).toBeGreaterThanOrEqual(3);
    // Entradas inválidas.
    expect((await w.call("get", w.ws.token, "/search?q=a")).status).toBe(400);
    expect((await w.call("get", w.ws.token, "/search?q=hola&cursor=basura")).status).toBe(400);
    expect((await w.call("get", w.ws.token, "/search")).status).toBe(400);
  }, 120_000);
});

// ─── PDF y DOCX ──────────────────────────────────────────────────────────────────────────

async function pdfWith(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText(text, { x: 50, y: 700, size: 14, font });
  return Buffer.from(await pdf.save());
}

async function docxWith(text: string): Promise<Buffer> {
  const entry = (path: string, xml: string) => {
    const data = Buffer.from(xml, "utf8");
    return {
      path,
      size: data.length,
      modified: new Date(),
      open: () => Promise.resolve(Readable.from(data)),
    };
  };
  const chunks: Buffer[] = [];
  for await (const chunk of zipStream([
    entry(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    entry(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    entry(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  ])) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Un archivo ya subido: el nodo, su versión y el objeto en el almacenamiento. */
async function fileNode(
  w: PagesWorld,
  name: string,
  mime: string,
  content: Buffer,
): Promise<string> {
  const id = randomUUID().replaceAll("-", "").slice(0, 25);
  const key = `${w.ws.workspaceId}/${id}/1-${randomUUID().replaceAll("-", "")}`;
  await ctx.deps.storage.putStream(key, Readable.from(content), {
    size: content.length,
    contentType: mime,
  });
  await ctx.prisma.node.create({
    data: {
      id,
      workspaceId: w.ws.workspaceId,
      spaceId: w.spaceId,
      type: "FILE",
      name,
      nameKey: name.toLowerCase(),
      position: "V",
      currentVersion: 1,
      mimeType: mime,
      sizeBytes: content.length,
      createdById: w.ownerMembership.id,
      updatedById: w.ownerMembership.id,
    },
  });
  await ctx.prisma.fileVersion.create({
    data: {
      workspaceId: w.ws.workspaceId,
      nodeId: id,
      version: 1,
      storageKey: key,
      fileName: name,
      mimeType: mime,
      sizeBytes: content.length,
      checksum: randomUUID().replaceAll("-", ""),
      uploadedById: w.ownerMembership.id,
    },
  });
  return id;
}

const jobDeps = () => ({
  prisma: ctx.prisma,
  storage: ctx.deps.storage,
  logger: ctx.deps.logger,
});

describe("texto de PDF y DOCX", () => {
  it("se extrae en el worker y se busca por contenido, con las mismas reglas de permisos", async () => {
    const w = await pagesWorld(ctx, "FTS archivos");
    const pdf = await fileNode(
      w,
      "Certificado.pdf",
      PDF_MIME,
      await pdfWith("Certificado de calibracion de balanzas"),
    );
    const docx = await fileNode(
      w,
      "Contrato.docx",
      DOCX_MIME,
      await docxWith("Contrato de limpieza industrial"),
    );
    // Antes de extraer, el contenido no está.
    expect((await search(w, w.ws.token, "balanzas")).items).toEqual([]);
    expect(
      await extractFileText(jobDeps(), { workspaceId: w.ws.workspaceId, nodeId: pdf, version: 1 }),
    ).toBe("OK");
    expect(
      await extractFileText(jobDeps(), { workspaceId: w.ws.workspaceId, nodeId: docx, version: 1 }),
    ).toBe("OK");

    const byPdf = await search(w, w.ws.token, "balanza");
    expect(byPdf.items.map((h) => [h.id, h.type])).toEqual([[pdf, "FILE"]]);
    expect(marked(byPdf.items[0]?.snippet ?? [])[0]).toBe("balanzas");
    expect((await search(w, w.ws.token, "limpieza industrial")).items.map((h) => h.id)).toEqual([
      docx,
    ]);
    // Quien no ve el espacio no los encuentra.
    expect((await search(w, w.stranger.token, "balanzas")).items).toEqual([]);
    expect((await search(w, w.stranger.token, "Certificado")).items).toEqual([]);
    expect((await search(w, w.outsider.token, "balanzas", "", w.outsider.slug)).items).toEqual([]);
    // Un archivo que no es PDF ni DOCX no se analiza.
    expect(
      await extractFileText(jobDeps(), { workspaceId: w.ws.workspaceId, nodeId: pdf, version: 9 }),
    ).toBe("SKIPPED");
  });

  it("un archivo ilegible queda marcado y no rompe nada", async () => {
    const w = await pagesWorld(ctx, "FTS archivo roto");
    const broken = await fileNode(w, "Roto.pdf", PDF_MIME, Buffer.from("esto no es un pdf"));
    expect(
      await extractFileText(jobDeps(), {
        workspaceId: w.ws.workspaceId,
        nodeId: broken,
        version: 1,
      }),
    ).toBe("FAILED");
    expect((await search(w, w.ws.token, "Roto")).items.map((h) => h.id)).toEqual([broken]);
  });
});

describe("reindexar", () => {
  it("rehace el índice de lo que quedó sin indexar y completa lo que falta", async () => {
    const w = await pagesWorld(ctx, "FTS reindexar");
    const page = await pageWith(
      w,
      "Manual de inducción",
      "Capacitación obligatoria para ingresantes.",
    );
    const pdf = await fileNode(
      w,
      "Reglamento.pdf",
      PDF_MIME,
      await pdfWith("Reglamento interno de seguridad"),
    );
    // Se pierde el índice (por ejemplo, contenido anterior a la búsqueda).
    await ctx.prisma
      .$executeRaw`UPDATE "Node" SET "searchTsv" = NULL, "searchText" = '' WHERE "workspaceId" = ${w.ws.workspaceId}`;
    expect((await search(w, w.ws.token, "capacitación")).items).toEqual([]);

    const queued: unknown[] = [];
    const result = await reindexSearch({
      ...jobDeps(),
      jobs: {
        enqueue: (_queue: string, payload: unknown) => {
          queued.push(payload);
          return Promise.resolve(null);
        },
      } as never,
    });
    expect(result.indexed).toBeGreaterThanOrEqual(2);
    expect(queued).toContainEqual({ workspaceId: w.ws.workspaceId, nodeId: pdf, version: 1 });
    expect((await search(w, w.ws.token, "capacitación")).items.map((h) => h.id)).toEqual([page]);
    // El PDF se encoló para extraer; una vez hecho, se encuentra por su contenido.
    await extractFileText(jobDeps(), { workspaceId: w.ws.workspaceId, nodeId: pdf, version: 1 });
    expect((await search(w, w.ws.token, "reglamento seguridad")).items.map((h) => h.id)).toEqual([
      pdf,
    ]);
    // Con «full» rehace todo y no cambia el resultado.
    await reindexSearch(
      { ...jobDeps(), jobs: { enqueue: () => Promise.resolve(null) } as never },
      { full: true },
    );
    expect((await search(w, w.ws.token, "capacitación")).items.map((h) => h.id)).toEqual([page]);
  });
});
