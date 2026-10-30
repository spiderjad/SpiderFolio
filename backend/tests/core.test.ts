// Piezas sin servicios externos: entorno, slugs, JWT, emails.
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.ts";
import { escapeHtml, renderEmail } from "../src/emails/layout.ts";
import { buildEmail } from "../src/emails/templates.ts";
import { signAccessToken, verifyAccessToken } from "../src/lib/jwt.ts";
import { firstFreeSlug, RESERVED_SLUGS, slugify } from "../src/lib/slug.ts";

const SECRET = "s".repeat(64);

export const validEnv = {
  NODE_ENV: "test",
  PORT: "4000",
  APP_URL: "http://localhost:5173",
  WEB_URL: "http://localhost:4321",
  JWT_ACCESS_SECRET: SECRET,
  JWT_ACCESS_TTL: "15m",
  REFRESH_TTL_DAYS: "30",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_USER: "",
  SMTP_PASS: "",
  MAIL_FROM: "SpiderFolio <no-reply@example.com>",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: "true",
  S3_BUCKET: "spiderfolio-files",
  S3_ACCESS_KEY: "clave",
  S3_SECRET_KEY: "secreto123",
  SENTRY_DSN: "",
  EMAIL_ENCRYPTION_KEY: Buffer.from("spiderfolio-dev-email-key-32byte").toString("base64"),
  EMAIL_ALLOW_PRIVATE_HOSTS: "true",
};

describe("loadEnv", () => {
  it("valida y convierte tipos", () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("rechaza un JWT_ACCESS_SECRET de menos de 64 caracteres sin mostrarlo", () => {
    const secret = "corto-y-secreto";
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: secret })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: secret })).not.toThrow(
      new RegExp(secret),
    );
  });

  it("nombra todas las variables que faltan", () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: "", MAIL_FROM: undefined })).toThrow(
      /DATABASE_URL, MAIL_FROM/,
    );
  });

  it.each(["15", "15x", "m15"])("rechaza JWT_ACCESS_TTL %s", (ttl) => {
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_TTL: ttl })).toThrow(/JWT_ACCESS_TTL/);
  });
});

describe("slugs", () => {
  it.each([
    ["Calidad y Ensayos S.A.", "calidad-y-ensayos-s-a"],
    ["Ñandú Logística", "nandu-logistica"],
    ["  --Árbol--  ", "arbol"],
    ["¡¡!!", "empresa"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("limita el largo sin dejar guiones al final", () => {
    const slug = slugify(`${"a".repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("usa sufijos ante colisiones y nunca un reservado", () => {
    expect(firstFreeSlug("acme", new Set())).toBe("acme");
    expect(firstFreeSlug("acme", new Set(["acme", "acme-2"]))).toBe("acme-3");
    for (const reserved of RESERVED_SLUGS) {
      expect(firstFreeSlug(reserved, new Set())).toBe(`${reserved}-2`);
    }
  });
});

describe("access token", () => {
  const claims = { userId: "u1", sessionId: "s1" };

  it("firma y verifica sub y sid", () => {
    const token = signAccessToken(claims, SECRET, 60);
    expect(verifyAccessToken(token, SECRET)).toEqual(claims);
  });

  it("rechaza otra clave, token vencido o alterado", () => {
    expect(verifyAccessToken(signAccessToken(claims, SECRET, 60), "x".repeat(64))).toBeNull();
    expect(verifyAccessToken(signAccessToken(claims, SECRET, -1), SECRET)).toBeNull();
    const [h, , s] = signAccessToken(claims, SECRET, 60).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "otro", sid: "s1" })).toString("base64url");
    expect(verifyAccessToken(`${h ?? ""}.${forged}.${s ?? ""}`, SECRET)).toBeNull();
  });

  it("rechaza alg none y tokens con otra audiencia (ej. MCP)", () => {
    const none = jwt.sign({ sid: "s1" }, "", {
      algorithm: "none",
      subject: "u1",
      audience: "spiderfolio-app",
      issuer: "spiderfolio",
    });
    expect(verifyAccessToken(none, SECRET)).toBeNull();
    const otherAudience = jwt.sign({ sid: "s1" }, SECRET, {
      subject: "u1",
      audience: "https://app.example.com/mcp",
      issuer: "spiderfolio",
    });
    expect(verifyAccessToken(otherAudience, SECRET)).toBeNull();
  });

  it("rechaza tokens sin sid", () => {
    const token = jwt.sign({}, SECRET, {
      subject: "u1",
      audience: "spiderfolio-app",
      issuer: "spiderfolio",
    });
    expect(verifyAccessToken(token, SECRET)).toBeNull();
  });
});

describe("emails", () => {
  it("escapa HTML", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });

  it("un nombre no puede inyectar HTML y hay versión de texto", () => {
    const email = buildEmail(
      { kind: "password-changed", userId: "u1" },
      { recipientName: '<img src=x onerror="alert(1)">', appUrl: "http://localhost:5173" },
    );
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
    expect(email.text).toContain('<img src=x onerror="alert(1)">');
    expect(email.subject).toBe("Tu contraseña de SpiderFolio cambió");
  });

  it("el aviso de inicio de sesión dice la hora en la zona de la empresa, y cuál es", () => {
    const at = new Date("2026-10-25T08:30:00Z"); // ya sin horario de verano en Madrid: 9:30
    const email = buildEmail(
      { kind: "new-login", userId: "u1", sessionId: "s1" },
      {
        recipientName: "Ana",
        appUrl: "http://localhost:5173",
        login: { userAgent: null, at },
        timeZone: "Europe/Madrid",
      },
    );
    expect(email.text).toContain("9:30");
    expect(email.text).toContain("(Europe/Madrid)");
    const santiago = buildEmail(
      { kind: "new-login", userId: "u1", sessionId: "s1" },
      {
        recipientName: "Ana",
        appUrl: "http://localhost:5173",
        login: { userAgent: null, at },
        timeZone: "America/Santiago",
      },
    );
    expect(santiago.text).toContain("5:30");
  });

  it("usa el color del workspace si se indica", () => {
    const email = renderEmail({
      subject: "s",
      title: "t",
      paragraphs: [],
      accentColor: "#0f766e",
    });
    expect(email.html).toContain("#0f766e");
  });
});
