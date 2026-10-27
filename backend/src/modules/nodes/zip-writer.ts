// Escritor de ZIP en flujo, sin compresión (método "store") y sin dependencias: cada entrada lleva
// un descriptor de datos tras sus bytes, así el CRC se calcula mientras se transmite. El tamaño
// total se conoce de antemano (Content-Length). Sin ZIP64: el llamador limita tamaño y cantidad.
import { crc32 } from "node:zlib";
import type { Readable } from "node:stream";

export interface ZipEntry {
  /** Ruta con "/"; las carpetas terminan en "/" y no tienen contenido. */
  path: string;
  size: number;
  modified: Date;
  /** Abre el contenido (no se llama en carpetas ni en archivos vacíos). */
  open: () => Promise<Readable>;
}

// Sin ZIP64 (tamaños y posiciones de 32 bits): con 3,9 GiB de datos queda margen para los encabezados.
// PutObject también llega a 5 GB, así que el mismo tope sirve para guardar el ZIP en el bucket.
export const ZIP_MAX_BYTES = 3.9 * 1024 ** 3;
export const ZIP_MAX_ENTRIES = 20_000;

const FLAGS = 0x0808; // descriptor de datos (bit 3) + nombres UTF-8 (bit 11)
const LOCAL_FIXED = 30;
const DESCRIPTOR = 16;
const CENTRAL_FIXED = 46;
const END = 22;

const nameOf = (entry: ZipEntry) => Buffer.from(entry.path, "utf8");

/** Largo exacto del ZIP que produce `zipStream`. */
export function zipSize(entries: readonly ZipEntry[]): number {
  let total = END;
  for (const entry of entries) {
    const name = nameOf(entry).length;
    total += LOCAL_FIXED + name + entry.size + DESCRIPTOR + CENTRAL_FIXED + name;
  }
  return total;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function* zipStream(entries: readonly ZipEntry[]): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = nameOf(entry);
    const { time, day } = dosDateTime(entry.modified);
    const local = Buffer.alloc(LOCAL_FIXED);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8); // sin compresión
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    // El CRC y los tamaños quedan en cero: van en el descriptor.
    local.writeUInt16LE(name.length, 26);
    yield Buffer.concat([local, name]);
    const startOffset = offset;
    offset += LOCAL_FIXED + name.length;

    let crc = 0;
    let written = 0;
    if (entry.size > 0) {
      const source = await entry.open();
      for await (const chunk of source as AsyncIterable<Buffer>) {
        written += chunk.length;
        if (written > entry.size) break;
        crc = crc32(chunk, crc);
        yield chunk;
      }
      if (written !== entry.size) throw new Error(`ZIP: tamaño inesperado en ${entry.path}`);
    }
    offset += written;

    const descriptor = Buffer.alloc(DESCRIPTOR);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(written, 8);
    descriptor.writeUInt32LE(written, 12);
    yield descriptor;
    offset += DESCRIPTOR;

    const header = Buffer.alloc(CENTRAL_FIXED);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(FLAGS, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(written, 20);
    header.writeUInt32LE(written, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entry.path.endsWith("/") ? 0x10 : 0, 38);
    header.writeUInt32LE(startOffset, 42);
    central.push(Buffer.concat([header, name]));
  }
  const directory = Buffer.concat(central);
  yield directory;
  const end = Buffer.alloc(END);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  yield end;
}
