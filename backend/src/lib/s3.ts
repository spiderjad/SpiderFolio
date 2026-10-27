import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

/** Variables de S3; config/env.ts las valida junto al resto al arrancar. */
export const s3EnvSchema = z.object({
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
  S3_REGION: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.preprocess(
    emptyToUndefined,
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  ),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
});

export interface S3Config {
  endpoint?: string;
  region: string;
  forcePathStyle: boolean;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const parsed = s3EnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuración de S3 inválida o incompleta: ${fields}`);
  }
  const e = parsed.data;
  return {
    ...(e.S3_ENDPOINT === undefined ? {} : { endpoint: e.S3_ENDPOINT }),
    region: e.S3_REGION,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    bucket: e.S3_BUCKET,
    accessKeyId: e.S3_ACCESS_KEY,
    secretAccessKey: e.S3_SECRET_KEY,
  };
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Sin checksums automáticos: el navegador no puede calcularlos en una subida prefirmada
    // y no todos los servicios compatibles con S3 (R2, RustFS) los aceptan igual que AWS.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
