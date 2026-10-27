import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createS3Client, s3ConfigFromEnv } from "../../src/lib/s3.ts";

// Compatibilidad del S3 local (RustFS) con lo que usa SpiderFolio (CLAUDE.md, sección 11).
// Requiere `docker compose up -d` y un .env con S3_ACCESS_KEY y S3_SECRET_KEY.

const config = s3ConfigFromEnv();
const s3 = createS3Client(config);
const bucket = config.bucket;
const appOrigin = process.env.APP_URL ?? "http://localhost:5173";
const prefix = `compat-test/${randomUUID()}`;
const createdKeys = new Set<string>();

const MiB = 1024 * 1024;

function newKey(name: string): string {
  const key = `${prefix}/${name}`;
  createdKeys.add(key);
  return key;
}

function objectUrl(key: string): string {
  const endpoint = (config.endpoint ?? "").replace(/\/$/, "");
  return `${endpoint}/${bucket}/${key}`;
}

async function expectNotFound(key: string): Promise<void> {
  const error: unknown = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toMatchObject({ $metadata: { httpStatusCode: 404 } });
}

beforeAll(async () => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se puede acceder al bucket "${bucket}" en ${config.endpoint ?? "AWS"}. ` +
        `¿Corriste docker compose up -d y completaste S3_ACCESS_KEY/S3_SECRET_KEY en .env? (${detail})`,
      { cause: error },
    );
  }
});

afterAll(async () => {
  await Promise.allSettled(
    [...createdKeys].map((key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))),
  );
  s3.destroy();
});

describe("S3 local: compatibilidad", () => {
  it("el bucket es privado: sin firma no se puede leer", async () => {
    const key = newKey("privado.txt");
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "secreto" }));
    const response = await fetch(objectUrl(key));
    expect(response.status).toBe(403);
  });

  it("CORS: el preflight de un PUT prefirmado acepta APP_URL y rechaza otros orígenes", async () => {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: newKey("preflight.txt"),
        ContentType: "text/plain",
      }),
      { expiresIn: 300 },
    );
    const preflight = (origin: string) =>
      fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      });

    const allowed = await preflight(appOrigin);
    expect(allowed.ok).toBe(true);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(appOrigin);
    expect(allowed.headers.get("access-control-allow-methods") ?? "").toMatch(/PUT/i);

    const denied = await preflight("https://otro-sitio.example");
    const deniedOrigin = denied.headers.get("access-control-allow-origin");
    expect(deniedOrigin).not.toBe("https://otro-sitio.example");
    expect(deniedOrigin).not.toBe("*");
  });

  it("PUT prefirmado desde el navegador y HeadObject con tamaño y tipo", async () => {
    const key = newKey("documento.pdf");
    const body = new Uint8Array(64 * 1024).fill(7);
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "application/pdf" }),
      { expiresIn: 300 },
    );

    const put = await fetch(url, {
      method: "PUT",
      headers: { Origin: appOrigin, "Content-Type": "application/pdf" },
      body,
    });
    expect(put.status).toBe(200);
    expect(put.headers.get("access-control-allow-origin")).toBe(appOrigin);

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    expect(head.ContentLength).toBe(body.byteLength);
    expect(head.ContentType).toBe("application/pdf");
  });

  it("un PUT prefirmado alterado se rechaza", async () => {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: newKey("firmado.txt"),
        ContentType: "text/plain",
      }),
      { expiresIn: 300 },
    );
    newKey("otro.txt");
    const response = await fetch(url.replace("firmado.txt", "otro.txt"), {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "x",
    });
    expect(response.status).toBe(403);
  });

  it("multipart con partes prefirmadas: subir, listar para reanudar y completar", async () => {
    const key = newKey("grande.zip");
    const parts = [new Uint8Array(5 * MiB).fill(1), new Uint8Array(1024).fill(2)];

    const created = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: "application/zip",
      }),
    );
    const uploadId = created.UploadId;
    if (uploadId === undefined) throw new Error("CreateMultipartUpload no devolvió UploadId");

    const etags: string[] = [];
    for (const [index, part] of parts.entries()) {
      const url = await getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: index + 1,
        }),
        { expiresIn: 300 },
      );
      const response = await fetch(url, {
        method: "PUT",
        headers: { Origin: appOrigin },
        body: part,
      });
      expect(response.status).toBe(200);
      // El navegador solo puede leer el ETag si CORS lo expone
      expect(response.headers.get("access-control-expose-headers") ?? "").toMatch(/etag/i);
      const etag = response.headers.get("etag");
      if (etag === null) throw new Error(`La parte ${String(index + 1)} no devolvió ETag`);
      etags.push(etag);
    }

    const listed = await s3.send(
      new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
    );
    expect(listed.Parts?.map((p) => p.PartNumber)).toEqual([1, 2]);

    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: etags.map((ETag, i) => ({ ETag, PartNumber: i + 1 })) },
      }),
    );

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    expect(head.ContentLength).toBe(5 * MiB + 1024);
  });

  it("un multipart abortado no deja objeto", async () => {
    const key = newKey("abortado.zip");
    const created = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
    const uploadId = created.UploadId;
    if (uploadId === undefined) throw new Error("CreateMultipartUpload no devolvió UploadId");
    await s3.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: 1,
        Body: new Uint8Array(1024),
      }),
    );
    await s3.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
    );
    await expectNotFound(key);
  });

  it("GET prefirmado de 60 s con Content-Disposition: attachment", async () => {
    const key = newKey("informe.docx");
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "contenido" }));
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: 'attachment; filename="informe.docx"',
      }),
      { expiresIn: 60 },
    );
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="informe.docx"');
    expect(await response.text()).toBe("contenido");
  });

  it("DeleteObject borra el objeto", async () => {
    const key = newKey("borrar.txt");
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "x" }));
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    await expectNotFound(key);
  });
});
