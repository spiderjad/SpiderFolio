import { describe, expect, it } from "vitest";
import { inspectContent, kindOfFileName } from "../src/lib/file-types.ts";
import { contentDisposition, newStorageKey } from "../src/lib/storage.ts";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex",
);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n", "latin1");
const EXE = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(200, 0x90)]);
const ZIP = Buffer.from("504b0304140000000000", "hex");

const inspect = async (name: string, content: Buffer) => {
  const kind = kindOfFileName(name);
  if (kind === null) throw new Error(`sin tipo para ${name}`);
  return await inspectContent(kind, content);
};

describe("tipos permitidos", () => {
  it("acepta las extensiones de la spec, sin distinguir mayúsculas", () => {
    for (const name of [
      "a.pdf",
      "a.DOCX",
      "a.xlsx",
      "a.pptx",
      "a.odt",
      "a.ods",
      "a.txt",
      "a.csv",
    ]) {
      expect(kindOfFileName(name), name).not.toBeNull();
    }
    for (const name of ["a.png", "a.JPG", "a.jpeg", "a.webp", "a.zip"]) {
      expect(kindOfFileName(name), name).not.toBeNull();
    }
  });

  it("rechaza ejecutables, scripts, HTML y SVG por extensión", () => {
    for (const name of [
      "a.exe",
      "a.sh",
      "a.bat",
      "a.js",
      "a.html",
      "a.htm",
      "a.svg",
      "a.xml",
      "a.dll",
      "a.msi",
      "a",
      "pdf",
      "a.pdf.exe",
    ]) {
      expect(kindOfFileName(name), name).toBeNull();
    }
  });
});

describe("contenido real (magic bytes)", () => {
  it("acepta lo que coincide con la extensión", async () => {
    expect(await inspect("a.png", PNG)).toEqual({ ok: true });
    expect(await inspect("a.pdf", PDF)).toEqual({ ok: true });
    expect(await inspect("a.zip", ZIP)).toEqual({ ok: true });
    expect(await inspect("a.docx", ZIP)).toEqual({ ok: true });
    expect(await inspect("a.txt", Buffer.from("Hola, acción y corazón\n", "utf8"))).toEqual({
      ok: true,
    });
    expect(await inspect("a.csv", Buffer.from("a,b\n1,2\n", "utf8"))).toEqual({ ok: true });
  });

  it("rechaza un ejecutable con extensión de documento o de imagen", async () => {
    for (const name of ["a.pdf", "a.png", "a.docx", "a.txt", "a.zip"]) {
      expect((await inspect(name, EXE)).ok, name).toBe(false);
    }
  });

  it("rechaza un tipo cambiado de extensión", async () => {
    expect((await inspect("a.png", PDF)).ok).toBe(false);
    expect((await inspect("a.pdf", PNG)).ok).toBe(false);
    expect((await inspect("a.txt", PNG)).ok).toBe(false);
    expect((await inspect("a.docx", PDF)).ok).toBe(false);
  });

  it("rechaza HTML, SVG y scripts disfrazados de texto o de imagen", async () => {
    const markup = [
      "<!DOCTYPE html><html><body><script>alert(1)</script></body></html>",
      '  <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<?xml version="1.0"?><svg/>',
      "<script>alert(1)</script>",
    ];
    for (const content of markup) {
      // Si file-type reconoce el XML o el SVG, es "mismatch"; si no, el chequeo de marcado.
      expect((await inspect("a.txt", Buffer.from(content))).ok).toBe(false);
      expect((await inspect("a.csv", Buffer.from(content))).ok).toBe(false);
      expect((await inspect("a.png", Buffer.from(content))).ok).toBe(false);
      expect((await inspect("a.pdf", Buffer.from(content))).ok).toBe(false);
    }
  });

  it("rechaza texto con bytes nulos o que no es UTF-8", async () => {
    expect(await inspect("a.txt", Buffer.from([0x68, 0x00, 0x69]))).toEqual({
      ok: false,
      reason: "binary",
    });
    expect((await inspect("a.txt", Buffer.from([0xff, 0xfe, 0xfd, 0x80]))).ok).toBe(false);
  });

  it("un texto cortado a mitad de un carácter multibyte sigue siendo texto", async () => {
    const full = Buffer.from("acción", "utf8");
    expect(await inspect("a.txt", full.subarray(0, full.length - 1))).toEqual({ ok: true });
  });
});

describe("almacenamiento", () => {
  it("la clave es workspace/nodo/versión-aleatorio y nunca lleva el nombre", () => {
    const a = newStorageKey("w1", "n1", 3);
    const b = newStorageKey("w1", "n1", 3);
    expect(a).toMatch(/^w1\/n1\/3-[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("Content-Disposition escapa comillas, saltos de línea y no ASCII", () => {
    const header = contentDisposition('in"for\r\nme ñ.pdf', false);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith("attachment;")).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    expect(contentDisposition("a.pdf", true).startsWith("inline;")).toBe(true);
  });
});
