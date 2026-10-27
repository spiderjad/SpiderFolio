// Saneado del contenido de las páginas (packages/content): lo único que decide qué documento se
// guarda. Nada desconocido entra, los enlaces son solo web o de correo y el tamaño tiene tope.
import {
  EMPTY_DOC,
  MAX_CONTENT_CHARS,
  validateContent,
  withoutThreadMarks,
} from "@spiderfolio/content";
import { describe, expect, it } from "vitest";

type Json = Parameters<typeof withoutThreadMarks>[0];
const doc = (...content: Json[]): Json => ({ type: "doc", content });
const paragraph = (text: string, marks?: Json["marks"]): Json => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks === undefined ? {} : { marks }) }],
});

describe("validateContent", () => {
  it("acepta el documento vacío y los bloques del producto", () => {
    expect(validateContent(EMPTY_DOC).ok).toBe(true);
    const full = doc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Título" }] },
      paragraph("Texto", [{ type: "bold" }]),
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph("uno")] }] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("hecho")] }],
      },
      { type: "callout", attrs: { tone: "warning" }, content: [paragraph("Ojo")] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableHeader", content: [paragraph("A")] }],
          },
          { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("1")] }] },
        ],
      },
      { type: "blockquote", content: [paragraph("cita")] },
      { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
      { type: "horizontalRule" },
    );
    const result = validateContent(full);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("Título");
  });

  it("rechaza nodos y marcas desconocidos, sin dejar pasar HTML ni scripts", () => {
    expect(validateContent(doc({ type: "script", content: [] })).ok).toBe(false);
    expect(validateContent(doc({ type: "html", attrs: { value: "<img onerror=x>" } })).ok).toBe(
      false,
    );
    expect(validateContent(doc(paragraph("x", [{ type: "style" }]))).ok).toBe(false);
    expect(validateContent({ type: "paragraph" }).ok).toBe(false);
    expect(validateContent("hola").ok).toBe(false);
    expect(validateContent(null).ok).toBe(false);
    expect(validateContent(undefined).ok).toBe(false);
  });

  it("solo deja enlaces http, https y de correo", () => {
    const link = (href: string) =>
      validateContent(doc(paragraph("x", [{ type: "link", attrs: { href } }])));
    expect(link("https://ejemplo.com/a?b=1").ok).toBe(true);
    expect(link("http://ejemplo.com").ok).toBe(true);
    expect(link("mailto:ana@ejemplo.com").ok).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:x",
      "//ejemplo.com",
      "",
    ]) {
      expect(link(bad), bad).toMatchObject({ ok: false, issue: "unsafe_link" });
    }
  });

  it("descarta atributos desconocidos y deja el documento en su forma canónica", () => {
    const result = validateContent(
      doc({ type: "paragraph", attrs: { onclick: "x()" }, content: [{ type: "text", text: "a" }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.content)).not.toContain("onclick");
  });

  it("tiene tope de tamaño", () => {
    const big = doc(paragraph("a".repeat(MAX_CONTENT_CHARS)));
    expect(validateContent(big)).toMatchObject({ ok: false, issue: "too_large" });
  });

  it("recoge imágenes, menciones e hilos que referencia (el servidor los verifica)", () => {
    const result = validateContent(
      doc(
        { type: "pageImage", attrs: { imageId: "img1", alt: "x" } },
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { membershipId: "mem1", label: "Ana" } },
            {
              type: "text",
              text: "dice",
              marks: [{ type: "commentThread", attrs: { threadId: "th1" } }],
            },
          ],
        },
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      imageIds: ["img1"],
      mentionIds: ["mem1"],
      threadIds: ["th1"],
    });
    // Sin id no hay referencia válida.
    expect(validateContent(doc({ type: "pageImage", attrs: { imageId: null } })).ok).toBe(false);
    expect(validateContent(doc({ type: "pageImage" })).ok).toBe(false);
  });
});

describe("withoutThreadMarks", () => {
  it("quita solo las marcas de hilos de comentario", () => {
    const marked = doc(
      paragraph("hola", [{ type: "bold" }, { type: "commentThread", attrs: { threadId: "t1" } }]),
    );
    const plain = doc(paragraph("hola", [{ type: "bold" }]));
    expect(withoutThreadMarks(marked)).toEqual(plain);
    const onlyThread = doc(
      paragraph("hola", [{ type: "commentThread", attrs: { threadId: "t" } }]),
    );
    expect(withoutThreadMarks(onlyThread)).toEqual(doc(paragraph("hola")));
  });
});
