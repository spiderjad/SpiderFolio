// Almacenamiento de archivos (docs/spec/archivos.md): S3 (R2, MinIO, RustFS en desarrollo) o el disco
// local de una instalación propia (STORAGE_DRIVER=local, lib/local-storage.ts). Todo
// el acceso a objetos pasa por acá: URLs prefirmadas de subida (5 min) y de descarga (60 s),
// subidas por partes con reanudación y borrado. Las claves son aleatorias, nunca el nombre original.
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { resolve } from "node:path";
import { createLocalStorage, createTokenSigner } from "./local-storage.ts";
import { createS3Client, s3ConfigFromEnv, type S3Config } from "./s3.ts";

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 60;

export interface UploadedPart {
  partNumber: number;
  size: number;
  etag: string;
}

export interface Storage {
  /** Origen (esquema + host + puerto) de las URLs prefirmadas: lo que la CSP debe permitir. */
  readonly origin: string;
  presignPut(key: string, options: { size: number; contentType: string }): Promise<string>;
  presignGet(
    key: string,
    options: { fileName: string; inline: boolean; contentType: string },
  ): Promise<string>;
  createMultipart(key: string, contentType: string): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipart(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Tamaño del objeto, o null si no existe. */
  head(key: string): Promise<{ size: number } | null>;
  stream(key: string): Promise<Readable>;
  /** Un tramo del objeto: de `start` (incluido) a `endExclusive` (no incluido). */
  rangeStream(key: string, start: number, endExclusive: number): Promise<Readable>;
  /** Sube un flujo de tamaño conocido (lo que se descomprime de un ZIP). */
  putStream(
    key: string,
    body: Readable,
    options: { size: number; contentType: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Clave de un objeto: workspaceId/nodeId/version-aleatorio (nunca el nombre del archivo). */
export function newStorageKey(workspaceId: string, nodeId: string, version: number): string {
  return `${workspaceId}/${nodeId}/${String(version)}-${randomBytes(16).toString("hex")}`;
}

/** Content-Disposition con el nombre original, seguro para cabeceras (RFC 6266 y 5987). */
export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%;]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function isNotFound(error: unknown): boolean {
  const meta = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata;
  return meta?.httpStatusCode === 404 || (error as { name?: string } | null)?.name === "NotFound";
}

/** Origen de las URLs prefirmadas: el endpoint (estilo de ruta) o el bucket como parte del host. */
export function storageOriginOf(config: S3Config): string {
  if (config.endpoint === undefined) {
    return `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
  }
  const url = new URL(config.endpoint);
  return config.forcePathStyle ? url.origin : `${url.protocol}//${config.bucket}.${url.host}`;
}

export function createStorageFromClient(client: S3Client, config: S3Config): Storage {
  const bucket = config.bucket;
  const origin = storageOriginOf(config);
  return {
    origin,
    presignPut: (key, { size, contentType }) =>
      // El tamaño y el tipo van firmados: quien sube no puede mandar otra cosa que lo reservado.
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: size,
        }),
        {
          expiresIn: UPLOAD_URL_TTL_SECONDS,
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      ),
    presignGet: (key, { fileName, inline, contentType }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(fileName, inline),
          ResponseContentType: contentType,
        }),
        { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
      ),
    createMultipart: async (key, contentType) => {
      const result = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      );
      if (result.UploadId === undefined) throw new Error("S3 no devolvió el id de la subida");
      return result.UploadId;
    },
    presignPart: (key, uploadId, partNumber) =>
      getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS },
      ),
    listParts: async (key, uploadId) => {
      const parts: UploadedPart[] = [];
      let marker: string | undefined;
      do {
        const page = await client.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            ...(marker === undefined ? {} : { PartNumberMarker: marker }),
          }),
        );
        for (const part of page.Parts ?? []) {
          if (part.PartNumber !== undefined && part.ETag !== undefined) {
            parts.push({ partNumber: part.PartNumber, size: part.Size ?? 0, etag: part.ETag });
          }
        }
        marker = page.IsTruncated === true ? page.NextPartNumberMarker : undefined;
      } while (marker !== undefined);
      return parts;
    },
    completeMultipart: async (key, uploadId, parts) => {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
    },
    abortMultipart: async (key, uploadId) => {
      try {
        await client.send(
          new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
        );
      } catch (error) {
        // Ya completada o abortada: no hay nada que abortar.
        if (!isNotFound(error) && (error as { name?: string }).name !== "NoSuchUpload") throw error;
      }
    },
    head: async (key) => {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: result.ContentLength ?? 0 };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    stream: async (key) => {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return result.Body as Readable;
    },
    rangeStream: async (key, start, endExclusive) => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=${String(start)}-${String(endExclusive - 1)}`,
        }),
      );
      return result.Body as Readable;
    },
    putStream: async (key, body, { size, contentType }) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: contentType,
        }),
      );
    },
    delete: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/**
 * Bucket de sistema: lo que genera la plataforma (ZIP grandes en segundo plano), con retención de
 * 7 días y fuera de la cuota. S3_SYSTEM_BUCKET, o "<S3_BUCKET>-system" si no se define.
 */
/** Disco local: «files» para los archivos y «system» para lo que genera la plataforma. */
function localStorageFromEnv(env: NodeJS.ProcessEnv, bucket: "files" | "system"): Storage {
  const { STORAGE_DIR: dir, APP_URL: appUrl, JWT_ACCESS_SECRET: secret } = env;
  if (dir === undefined || appUrl === undefined || secret === undefined) {
    throw new Error("Con STORAGE_DRIVER=local hacen falta STORAGE_DIR, APP_URL y JWT_ACCESS_SECRET");
  }
  return createLocalStorage({ root: resolve(dir), bucket, appUrl, signer: createTokenSigner(secret) });
}

export function createSystemStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.STORAGE_DRIVER === "local") return localStorageFromEnv(env, "system");
  const base = s3ConfigFromEnv(env);
  const bucket = env.S3_SYSTEM_BUCKET?.trim();
  const config = {
    ...base,
    bucket: bucket === undefined || bucket === "" ? `${base.bucket}-system` : bucket,
  };
  return createStorageFromClient(createS3Client(config), config);
}

export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.STORAGE_DRIVER === "local") return localStorageFromEnv(env, "files");
  const config = s3ConfigFromEnv(env);
  return createStorageFromClient(createS3Client(config), config);
}
