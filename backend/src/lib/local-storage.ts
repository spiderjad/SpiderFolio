// Almacenamiento en disco local (docs/instalacion/README.md): la alternativa a S3 para una instalación
// propia. Misma interfaz que S3 (lib/storage.ts): las «URLs prefirmadas» apuntan a la propia API
// (/api/v1/storage/:token) con un token HMAC que fija la operación, la clave, el vencimiento y, al
// subir, el tamaño y el tipo. El navegador sube y descarga igual que con S3. Las claves son las mismas
// (workspaceId/nodeId/versión-aleatorio): nunca nombres de archivo, y nunca salen de STORAGE_DIR.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { z } from "zod";
import {
  contentDisposition,
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  type Storage,
  type UploadedPart,
} from "./storage.ts";

/** Ruta pública de las operaciones firmadas, bajo la API. */
export const LOCAL_STORAGE_PATH = "/api/v1/storage";

const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,299}$/u;
const UPLOAD_ID = /^[a-f0-9]{32}$/u;

const TokenSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("put"),
    bucket: z.string(),
    key: z.string(),
    exp: z.number(),
    size: z.number().int().nonnegative(),
    type: z.string(),
  }),
  z.strictObject({
    op: z.literal("part"),
    bucket: z.string(),
    key: z.string(),
    exp: z.number(),
    uploadId: z.string(),
    part: z.number().int().min(1).max(10000),
  }),
  z.strictObject({
    op: z.literal("get"),
    bucket: z.string(),
    key: z.string(),
    exp: z.number(),
    type: z.string(),
    disposition: z.string(),
  }),
]);
export type LocalToken = z.infer<typeof TokenSchema>;

/** Firma y lee tokens de almacenamiento. La clave se deriva del secreto dado (nunca viaja). */
export function createTokenSigner(secret: string) {
  const key = createHmac("sha256", secret).update("spiderfolio-local-storage-v1").digest();
  const mac = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    sign(token: LocalToken): string {
      const payload = Buffer.from(JSON.stringify(token)).toString("base64url");
      return `${payload}.${mac(payload)}`;
    },
    /** El token si la firma es válida y no venció; null si no. */
    verify(raw: string, now: number = Date.now()): LocalToken | null {
      const [payload, signature, extra] = raw.split(".");
      if (payload === undefined || signature === undefined || extra !== undefined) return null;
      const expected = Buffer.from(mac(payload));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        return null;
      }
      const result = TokenSchema.safeParse(parsed);
      if (!result.success || result.data.exp * 1000 <= now) return null;
      return result.data;
    },
  };
}
export type TokenSigner = ReturnType<typeof createTokenSigner>;

export interface LocalStorageConfig {
  /** Carpeta raíz (STORAGE_DIR). */
  root: string;
  /** «files» o «system» (los ZIP generados): subcarpetas de la raíz. */
  bucket: string;
  /** Origen público de la app (APP_URL): ahí apuntan las URLs firmadas. */
  appUrl: string;
  signer: TokenSigner;
}

/** Ruta en disco de una clave, sin salir de la carpeta del bucket. */
export function pathOf(root: string, bucket: string, key: string): string {
  if (!KEY.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Clave de almacenamiento inválida");
  }
  const base = resolve(root, bucket);
  const full = resolve(base, key);
  if (!full.startsWith(base + sep)) throw new Error("Clave de almacenamiento inválida");
  return full;
}

function uploadDir(root: string, bucket: string, uploadId: string): string {
  if (!UPLOAD_ID.test(uploadId)) throw new Error("Subida inválida");
  return join(resolve(root, ".uploads", bucket), uploadId);
}

const partFile = (dir: string, part: number) => join(dir, `${String(part).padStart(5, "0")}.part`);

/** Escribe un flujo en un archivo temporal y lo mueve al final (nunca queda un archivo a medias). */
export async function writeAtomically(file: string, body: Readable): Promise<number> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await pipeline(body, createWriteStream(temp, { flags: "wx" }));
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return (await stat(file)).size;
}

export function createLocalStorage(config: LocalStorageConfig): Storage {
  const { root, bucket, signer } = config;
  const origin = new URL(config.appUrl).origin;
  const url = (token: LocalToken) => `${origin}${LOCAL_STORAGE_PATH}/${signer.sign(token)}`;
  const expires = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;
  const file = (key: string) => pathOf(root, bucket, key);

  return {
    origin,
    presignPut: (key, { size, contentType }) => {
      file(key);
      return Promise.resolve(
        url({ op: "put", bucket, key, exp: expires(UPLOAD_URL_TTL_SECONDS), size, type: contentType }),
      );
    },
    presignGet: (key, { fileName, inline, contentType }) => {
      file(key);
      return Promise.resolve(
        url({
          op: "get",
          bucket,
          key,
          exp: expires(DOWNLOAD_URL_TTL_SECONDS),
          type: contentType,
          disposition: contentDisposition(fileName, inline),
        }),
      );
    },
    createMultipart: async (key) => {
      file(key);
      const uploadId = randomBytes(16).toString("hex");
      await mkdir(uploadDir(root, bucket, uploadId), { recursive: true });
      return uploadId;
    },
    presignPart: (key, uploadId, partNumber) => {
      file(key);
      uploadDir(root, bucket, uploadId);
      return Promise.resolve(
        url({ op: "part", bucket, key, exp: expires(UPLOAD_URL_TTL_SECONDS), uploadId, part: partNumber }),
      );
    },
    listParts: async (_key, uploadId) => {
      const dir = uploadDir(root, bucket, uploadId);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const parts: UploadedPart[] = [];
      for (const name of names.filter((n) => n.endsWith(".part")).sort()) {
        const size = (await stat(join(dir, name))).size;
        const partNumber = Number(name.slice(0, 5));
        parts.push({ partNumber, size, etag: await partEtag(join(dir, name)) });
      }
      return parts;
    },
    completeMultipart: async (key, uploadId, parts) => {
      const dir = uploadDir(root, bucket, uploadId);
      const target = file(key);
      await mkdir(dirname(target), { recursive: true });
      const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      const out = createWriteStream(temp, { flags: "wx" });
      try {
        for (const part of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
          const path = partFile(dir, part.partNumber);
          if ((await partEtag(path)) !== part.etag) throw new Error("Parte distinta de la subida");
          await pipeline(createReadStream(path), out, { end: false });
        }
        await new Promise<void>((done, fail) => {
          out.end((error?: Error | null) => {
            if (error) fail(error);
            else done();
          });
        });
        await rename(temp, target);
      } catch (error) {
        out.destroy();
        await rm(temp, { force: true });
        throw error;
      }
      await rm(dir, { recursive: true, force: true });
    },
    abortMultipart: async (_key, uploadId) => {
      await rm(uploadDir(root, bucket, uploadId), { recursive: true, force: true });
    },
    head: async (key) => {
      try {
        return { size: (await stat(file(key))).size };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    stream: (key) => Promise.resolve(createReadStream(file(key))),
    rangeStream: (key, start, endExclusive) =>
      Promise.resolve(createReadStream(file(key), { start, end: endExclusive - 1 })),
    putStream: async (key, body) => {
      await writeAtomically(file(key), body);
    },
    delete: async (key) => {
      try {
        await unlink(file(key));
      } catch (error) {
        // Borrar lo que no existe no es un error (igual que en S3).
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

/** ETag de una parte: MD5 entre comillas, como S3. */
export async function partEtag(path: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `"${hash.digest("hex")}"`;
}

/** Ruta en disco de una parte (para el manejador de subidas). */
export function partPath(root: string, bucket: string, uploadId: string, part: number): string {
  return partFile(uploadDir(root, bucket, uploadId), part);
}
