import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// .env.example es el contrato de configuración (CLAUDE.md, sección 4).
const REQUIRED_KEYS = [
  "NODE_ENV",
  "PORT",
  "APP_URL",
  "WEB_URL",
  "JWT_ACCESS_SECRET",
  "JWT_ACCESS_TTL",
  "REFRESH_TTL_DAYS",
  "DATABASE_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "MAIL_FROM",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_BUCKET",
  "S3_SYSTEM_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "GOTENBERG_URL",
  "SENTRY_DSN",
  "SEED_DEMO_PASSWORD",
  "TERMS_VERSION",
  "EMAIL_ENCRYPTION_KEY",
  "MFA_ENCRYPTION_KEY",
  "EMAIL_ALLOW_PRIVATE_HOSTS",
  "EMAIL_DOMAIN_PROVIDER",
  "BIAN_ENABLED",
  "ANTHROPIC_API_KEY",
  "STORAGE_DRIVER",
  "STORAGE_DIR",
  "APP_STATIC_DIR",
  "TRUST_PROXY_HOPS",
  "PLUGINS_DIR",
  "PLUGIN_PACKAGES",
];

// Nunca deben traer valor en el ejemplo.
const SECRET_KEYS = [
  "JWT_ACCESS_SECRET",
  "SMTP_PASS",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "SENTRY_DSN",
  "SEED_DEMO_PASSWORD",
  "ANTHROPIC_API_KEY",
  "MFA_ENCRYPTION_KEY",
];

const env = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));

function parseEnv(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const value = match[2].replace(/\s+#.*$/, "").trim();
    entries.set(match[1], value);
  }
  return entries;
}

describe(".env.example", () => {
  it("declara todas las variables de la sección 4 de CLAUDE.md y ninguna más", () => {
    expect([...env.keys()].sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  it("no trae valores para los secretos", () => {
    for (const key of SECRET_KEYS) {
      expect(env.get(key), key).toBe("");
    }
  });

  it("usa path style por defecto para el S3 local", () => {
    expect(env.get("S3_FORCE_PATH_STYLE")).toBe("true");
  });
});
