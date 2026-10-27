// Piezas puras de los documentos controlados: el HTML de una página (nada del documento se inserta
// sin escapar), los bloques para comparar, la comparación y el estampado del PDF.
import { contentToBlocks, contentToHtml } from "@spiderfolio/content";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { diffBlocks } from "../src/modules/documents/compare.service.ts";
import { stampPdf } from "../src/modules/documents/pdf.ts";

type Json = Parameters<typeof contentToHtml>[0];
const doc = (...content: NonNullable<Json["content"]>): Json => ({ type: "doc", content });

describe("contentToHtml", () => {
  it("escapa el texto y no deja pasar etiquetas ni enlaces peligrosos", () => {
    const html = contentToHtml(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: '<img src=x onerror="alert(1)">' },
          {
            type: "text",
            text: "mal",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
          {
            type: "text",
            text: "bien",
            marks: [{ type: "link", attrs: { href: "https://ejemplo.com/?a=1&b=2" } }],
          },
        ],
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://ejemplo.com/?a=1&amp;b=2"');
  });

  it("una imagen solo sale con la dirección que resolvió quien llama", () => {
    const node = doc({ type: "pageImage", attrs: { imageId: "i1", alt: '"><script>' } });
    expect(contentToHtml(node)).toContain("[Imagen");
    const html = contentToHtml(node, { imageSrc: () => "data:image/png;base64,AAAA" });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain("<script>");
  });
});

describe("comparar", () => {
  const before = contentToBlocks(
    doc(
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Título" }] },
      { type: "paragraph", content: [{ type: "text", text: "Lavar las manos antes de entrar." }] },
      { type: "paragraph", content: [{ type: "text", text: "Se quita." }] },
    ),
  );
  const after = contentToBlocks(
    doc(
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Título" }] },
      { type: "paragraph", content: [{ type: "text", text: "Lavar las manos al entrar." }] },
      { type: "paragraph", content: [{ type: "text", text: "Se agrega." }] },
    ),
  );

  it("marca los bloques cambiados con sus palabras, y los agregados y quitados", () => {
    const result = diffBlocks(before, after);
    expect(result.stats).toEqual({ added: 0, removed: 0, changed: 2 });
    const changed = result.blocks.find((b) => b.kind === "changed");
    expect(
      changed?.kind === "changed" &&
        changed.words.some((w) => w.op === "remove" && w.text.includes("antes")),
    ).toBe(true);
    expect(diffBlocks([], ["a"]).stats).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(diffBlocks(["a"], []).stats).toEqual({ added: 0, removed: 1, changed: 0 });
    expect(diffBlocks(before, before).stats).toEqual({ added: 0, removed: 0, changed: 0 });
  });
});

describe("stampPdf", () => {
  const blank = async (pages: number) => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) pdf.addPage([595, 842]);
    return await pdf.save();
  };

  it("estampa todas las páginas y agrega la hoja de control a los PDF subidos", async () => {
    const out = await stampPdf(await blank(2), {
      watermark: "Copia no controlada · descargada por Ñandú el 22/10/26 😀",
      obsolete: true,
      controlSheet: {
        workspaceName: "Empresa",
        code: "PRC-001",
        title: "Título con ñ",
        version: 2,
        effective: "22 de octubre de 2026",
        elaboratedBy: "Ana",
        approvedBy: [{ name: "Luis", at: "22/10" }],
      },
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it("un archivo que no es un PDF válido se rechaza con un mensaje, sin romper", async () => {
    await expect(
      stampPdf(new TextEncoder().encode("no soy un pdf"), { watermark: "x", obsolete: false }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
