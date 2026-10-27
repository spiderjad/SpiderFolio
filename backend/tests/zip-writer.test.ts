// El ZIP en flujo: lo que se escribe lo lee yauzl con sus CRC y tamaños, y Content-Length es exacto.
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import * as yauzl from "yauzl";
import { zipSize, zipStream, type ZipEntry } from "../src/modules/nodes/zip-writer.ts";

const file = (path: string, text: string): ZipEntry => ({
  path,
  size: Buffer.byteLength(text),
  modified: new Date(2026, 9, 21, 12, 0, 0),
  open: () => Promise.resolve(Readable.from([Buffer.from(text)])),
});

async function build(entries: ZipEntry[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of zipStream(entries)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function read(zip: Buffer): Promise<Map<string, string>> {
  const archive = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (error, opened) => {
      if (error !== null) reject(error);
      else resolve(opened);
    });
  });
  const out = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    archive.on("error", reject);
    archive.on("end", resolve);
    archive.on("entry", (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith("/")) {
        out.set(entry.fileName, "");
        archive.readEntry();
        return;
      }
      archive.openReadStream(entry, (error, stream) => {
        if (error !== null) {
          reject(error);
          return;
        }
        const parts: Buffer[] = [];
        stream.on("data", (part: Buffer) => parts.push(part));
        stream.on("end", () => {
          out.set(entry.fileName, Buffer.concat(parts).toString("utf8"));
          archive.readEntry();
        });
        stream.on("error", reject);
      });
    });
    archive.readEntry();
  });
  return out;
}

describe("zipStream", () => {
  it("escribe archivos, carpetas vacías y nombres con tildes que yauzl lee con CRC válido", async () => {
    const entries: ZipEntry[] = [
      file("Calidad/Procedimiento ñ.txt", "hola mundo"),
      file("Calidad/vacío.txt", ""),
      {
        path: "Calidad/Sin nada/",
        size: 0,
        modified: new Date(),
        open: () => Promise.reject(new Error("no se abre")),
      },
    ];
    const zip = await build(entries);
    expect(zip.length).toBe(zipSize(entries));
    const read1 = await read(zip);
    expect(read1.get("Calidad/Procedimiento ñ.txt")).toBe("hola mundo");
    expect(read1.get("Calidad/vacío.txt")).toBe("");
    expect(read1.has("Calidad/Sin nada/")).toBe(true);
  });

  it("falla si el archivo pesa distinto de lo declarado", async () => {
    const lying: ZipEntry = { ...file("a.txt", "abc"), size: 10 };
    await expect(build([lying])).rejects.toThrow();
  });
});
