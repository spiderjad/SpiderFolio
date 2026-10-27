// Piezas de auth sin base: protecciones del seed, vencimiento de sesiones, esquemas y enlaces.
import { describe, expect, it } from "vitest";
import { assertSafeSeedTarget } from "../prisma/seed-guard.ts";
import { describeDevice, tokenLink } from "../src/emails/templates.ts";
import { EmailSchema, RegisterSchema } from "../src/modules/auth/auth.schemas.ts";
import { sessionExpiry } from "../src/modules/auth/sessions.service.ts";

const DAY = 24 * 3600 * 1000;

describe("seed: solo contra una base local", () => {
  const ok = {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://spiderfolio:spiderfolio@localhost:5432/spiderfolio",
    SEED_DEMO_PASSWORD: "una-clave-local",
  };

  it("acepta localhost, 127.0.0.1 y ::1", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const url = `postgresql://u:p@${host}:5432/db`;
      expect(assertSafeSeedTarget({ ...ok, DATABASE_URL: url }).databaseUrl).toBe(url);
    }
  });

  it.each([
    "postgresql://u:p@db.example.com:5432/spiderfolio",
    "postgresql://u:p@10.0.0.5:5432/spiderfolio",
    "postgresql://u:p@postgres:5432/spiderfolio",
    "postgresql://u:p@localhost.example.com/spiderfolio",
  ])("rechaza %s sin mostrar la URL", (url) => {
    expect(() => assertSafeSeedTarget({ ...ok, DATABASE_URL: url })).toThrow(/base local/);
    expect(() => assertSafeSeedTarget({ ...ok, DATABASE_URL: url })).not.toThrow(/u:p@/);
  });

  it("rechaza NODE_ENV=production aunque la base sea local", () => {
    expect(() => assertSafeSeedTarget({ ...ok, NODE_ENV: "production" })).toThrow(/production/);
  });

  it("exige SEED_DEMO_PASSWORD de al menos 10 caracteres", () => {
    expect(() => assertSafeSeedTarget({ ...ok, SEED_DEMO_PASSWORD: "" })).toThrow(
      /SEED_DEMO_PASSWORD/,
    );
    expect(() => assertSafeSeedTarget({ ...ok, SEED_DEMO_PASSWORD: "corta" })).toThrow(
      /SEED_DEMO_PASSWORD/,
    );
  });

  it("rechaza una DATABASE_URL vacía o inválida", () => {
    expect(() => assertSafeSeedTarget({ ...ok, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });
});

describe("vencimiento de sesiones (7.1)", () => {
  const policy = { refreshTtlDays: 30, maxAgeDays: 90 };
  const login = new Date("2026-01-01T00:00:00Z");

  it("al principio manda la inactividad: último uso + 30 días", () => {
    const now = new Date(login.getTime() + 10 * DAY);
    expect(sessionExpiry(login, now, policy).getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it("cerca del tope, la rotación no lo extiende: login + 90 días", () => {
    const now = new Date(login.getTime() + 80 * DAY);
    expect(sessionExpiry(login, now, policy).getTime()).toBe(login.getTime() + 90 * DAY);
  });

  it("pasado el tope, ya venció", () => {
    const now = new Date(login.getTime() + 91 * DAY);
    expect(sessionExpiry(login, now, policy).getTime()).toBeLessThan(now.getTime());
  });
});

describe("esquemas", () => {
  it("normaliza el email", () => {
    expect(EmailSchema.parse("  Ana.Ruiz@Empresa.COM ")).toBe("ana.ruiz@empresa.com");
  });

  it.each([
    [{ name: "A" }, "name"],
    [{ password: "corta" }, "password"],
    [{ companyName: "x".repeat(81) }, "companyName"],
    [{ email: "no-es-email" }, "email"],
    [{ timezone: "Marte/Olympus" }, "timezone"],
    [{ extra: true }, ""],
    [{ acceptTerms: false }, "acceptTerms"],
    [{ acceptTerms: undefined }, "acceptTerms"],
  ])("el registro rechaza %j", (override, field) => {
    const base = {
      name: "Ana Ruiz",
      email: "ana@empresa.com",
      password: "una-clave-segura",
      companyName: "Empresa",
      acceptTerms: true,
    };
    const result = RegisterSchema.safeParse({ ...base, ...override });
    expect(result.success).toBe(false);
    if (!result.success && field !== "") {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain(field);
    }
  });
});

describe("enlaces y dispositivos", () => {
  it("el token va en el fragmento, no en la query", () => {
    const link = tokenLink("https://app.example.com", "/verify-email", "abc_DEF-123");
    expect(link).toBe("https://app.example.com/verify-email#token=abc_DEF-123");
    expect(new URL(link).search).toBe("");
  });

  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36",
      "Chrome en Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      "Safari en iOS",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox en Linux"],
    ["curl/8.4.0", "dispositivo desconocido"],
  ])("describe %s", (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });
});
