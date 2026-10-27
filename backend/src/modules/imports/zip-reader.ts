// Lectura de un ZIP que está en S3 sin bajarlo entero: yauzl pide tramos (rangos) del objeto. Solo se
// lee el directorio central y, de a una, las entradas que se descomprimen.
import { PassThrough, type Readable } from "node:stream";
import * as yauzl from "yauzl";
import type { Storage } from "../../lib/storage.ts";

class StorageReader extends yauzl.RandomAccessReader {
  private readonly storage: Storage;
  private readonly key: string;

  constructor(storage: Storage, key: string) {
    super();
    this.storage = storage;
    this.key = key;
  }

  override _readStreamForRange(start: number, end: number): Readable {
    const out = new PassThrough();
    this.storage.rangeStream(this.key, start, end).then(
      (source) => {
        source.on("error", (error) => out.destroy(error));
        source.pipe(out);
      },
      (error: unknown) => out.destroy(error instanceof Error ? error : new Error(String(error))),
    );
    return out;
  }
}

/**
 * Abre el ZIP con lectura entrada por entrada. Los nombres se leen crudos (decodeStrings: false):
 * yauzl corta todo el archivo ante un nombre con "..", y acá se prefiere omitir solo esa entrada.
 * validateEntrySizes hace fallar la lectura de una entrada cuyo tamaño real no coincide con el declarado.
 */
export async function openZip(storage: Storage, key: string, size: number): Promise<yauzl.ZipFile> {
  return await yauzl.fromRandomAccessReaderPromise(new StorageReader(storage, key), size, {
    lazyEntries: true,
    decodeStrings: false,
    validateEntrySizes: true,
    autoClose: false,
  });
}

/** Un symlink se reconoce por los atributos Unix que guarda el ZIP (tipo S_IFLNK en los 16 bits altos). */
export function isSymlink(entry: yauzl.Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}
