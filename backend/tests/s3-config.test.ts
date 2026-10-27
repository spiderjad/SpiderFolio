import { describe, expect, it } from "vitest";
import { s3ConfigFromEnv } from "../src/lib/s3.ts";

const base = {
  S3_REGION: "auto",
  S3_BUCKET: "spiderfolio-files",
  S3_ACCESS_KEY: "clave",
  S3_SECRET_KEY: "secreto",
};

describe("s3ConfigFromEnv", () => {
  it("usa endpoint y path style de las variables de entorno", () => {
    const config = s3ConfigFromEnv({
      ...base,
      S3_ENDPOINT: "http://localhost:9000",
      S3_FORCE_PATH_STYLE: "true",
    });
    expect(config).toEqual({
      endpoint: "http://localhost:9000",
      region: "auto",
      forcePathStyle: true,
      bucket: "spiderfolio-files",
      accessKeyId: "clave",
      secretAccessKey: "secreto",
    });
  });

  it("sin S3_ENDPOINT ni S3_FORCE_PATH_STYLE usa los valores por defecto del SDK", () => {
    const config = s3ConfigFromEnv({ ...base, S3_ENDPOINT: "", S3_FORCE_PATH_STYLE: "" });
    expect(config.endpoint).toBeUndefined();
    expect(config.forcePathStyle).toBe(false);
  });

  it("rechaza valores de S3_FORCE_PATH_STYLE que no sean true o false", () => {
    expect(() => s3ConfigFromEnv({ ...base, S3_FORCE_PATH_STYLE: "si" })).toThrow(
      /S3_FORCE_PATH_STYLE/,
    );
  });

  it("nombra las variables que faltan sin mostrar sus valores", () => {
    let message = "";
    try {
      s3ConfigFromEnv({ S3_REGION: "auto", S3_SECRET_KEY: "no-mostrar" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("S3_BUCKET, S3_ACCESS_KEY");
    expect(message).not.toContain("no-mostrar");
  });
});
