import { describe, expect, it } from "vitest";
import { cspDirectives, cspHeader, storageOriginFromEnv } from "../csp.ts";

describe("CSP con el origen de S3", () => {
  it("local: el endpoint de RustFS, con estilo de ruta", () => {
    const origin = storageOriginFromEnv({
      S3_ENDPOINT: "http://localhost:9000",
      S3_BUCKET: "spiderfolio-files",
      S3_REGION: "auto",
      S3_FORCE_PATH_STYLE: "true",
    });
    expect(origin).toBe("http://localhost:9000");
  });

  it("producción (R2 con host virtual): el bucket forma parte del host", () => {
    expect(
      storageOriginFromEnv({
        S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
        S3_BUCKET: "spiderfolio-files",
        S3_REGION: "auto",
        S3_FORCE_PATH_STYLE: "false",
      }),
    ).toBe("https://spiderfolio-files.acct.r2.cloudflarestorage.com");
  });

  it("sin endpoint, el de AWS; sin bucket, ninguno", () => {
    expect(
      storageOriginFromEnv({ S3_BUCKET: "b-files", S3_REGION: "eu-west-1", S3_ENDPOINT: "" }),
    ).toBe("https://b-files.s3.eu-west-1.amazonaws.com");
    expect(storageOriginFromEnv({})).toBeNull();
  });

  it("agrega el origen exacto a img, connect y frame, sin comodines ni unsafe-inline en scripts", () => {
    const header = cspHeader("http://localhost:9000");
    const directives = cspDirectives("http://localhost:9000");
    expect(directives["img-src"]).toContain("http://localhost:9000");
    expect(directives["connect-src"]).toContain("http://localhost:9000");
    expect(directives["frame-src"]).toEqual(["http://localhost:9000"]);
    expect(directives["script-src"]).toEqual(["'self'"]);
    expect(directives["worker-src"]).toEqual(["'self'"]);
    expect(directives["manifest-src"]).toEqual(["'self'"]);
    expect(header).not.toMatch(/\*|unsafe-eval/);
    expect(header).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(cspHeader()).not.toContain("frame-src");
  });
});
