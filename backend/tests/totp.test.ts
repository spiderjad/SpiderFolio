// 2FA, paso 1: TOTP (vectores del RFC), códigos de recuperación y cifrado del secreto. Lógica pura.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.ts";
import { createMfaBox, CURRENT_MFA_KEY_ID } from "../src/lib/mfa-box.ts";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  otpauthUri,
  RECOVERY_CODE_COUNT,
  stepOf,
  totpAt,
  verifyTotp,
} from "../src/lib/totp.ts";
import { validEnv } from "./core.test.ts";

// Secreto de los vectores del RFC 4226 y 6238: "12345678901234567890" en ASCII.
const RFC_SECRET = Buffer.from("12345678901234567890");
const RFC_SECRET_B32 = base32Encode(RFC_SECRET);
const at = (seconds: number) => new Date(seconds * 1000);

describe("HOTP y TOTP", () => {
  it("coincide con los vectores del RFC 4226 (contador 0 a 9)", () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expected.forEach((code, counter) => {
      expect(hotp(RFC_SECRET, counter)).toBe(code);
    });
  });

  it("coincide con los vectores del RFC 6238 (SHA-1, 8 dígitos)", () => {
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
    ];
    for (const [seconds, code] of vectors) {
      expect(hotp(RFC_SECRET, stepOf(at(seconds)), 8)).toBe(code);
    }
  });

  it("el código de 6 dígitos es el final del de 8", () => {
    expect(totpAt(RFC_SECRET_B32, at(59))).toBe("287082");
  });
});

describe("verifyTotp", () => {
  const now = at(1_700_000_000);
  const code = totpAt(RFC_SECRET_B32, now);

  it("acepta el código del paso actual y devuelve ese paso", () => {
    expect(verifyTotp(RFC_SECRET_B32, code, now)).toBe(stepOf(now));
  });

  it("tolera un paso de desfase a cada lado, no dos", () => {
    const earlier = totpAt(RFC_SECRET_B32, at(1_700_000_000 - 30));
    const later = totpAt(RFC_SECRET_B32, at(1_700_000_000 + 30));
    const farther = totpAt(RFC_SECRET_B32, at(1_700_000_000 - 60));
    expect(verifyTotp(RFC_SECRET_B32, earlier, now)).toBe(stepOf(now) - 1);
    expect(verifyTotp(RFC_SECRET_B32, later, now)).toBe(stepOf(now) + 1);
    expect(verifyTotp(RFC_SECRET_B32, farther, now)).toBeNull();
  });

  it("un código ya usado (o de un paso anterior al último aceptado) no vale otra vez", () => {
    const step = stepOf(now);
    expect(verifyTotp(RFC_SECRET_B32, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, code, now, step + 5)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, code, now, step - 1)).toBe(step);
  });

  it("rechaza códigos mal formados o incorrectos", () => {
    const wrong = code === "000000" ? "000001" : "000000";
    for (const bad of [wrong, "12345", "1234567", "abcdef", "", "12 34 5"]) {
      expect(verifyTotp(RFC_SECRET_B32, bad, now)).toBeNull();
    }
  });

  it("ignora espacios dentro del código (las apps lo muestran como «123 456»)", () => {
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET_B32, spaced, now)).toBe(stepOf(now));
  });
});

describe("base32 y secretos", () => {
  it("ida y vuelta, con minúsculas, espacios y guiones", () => {
    const bytes = randomBytes(20);
    const text = base32Encode(bytes);
    expect(base32Decode(text).equals(bytes)).toBe(true);
    const messy = text.toLowerCase().replace(/(.{4})/gu, "$1 ");
    expect(base32Decode(messy).equals(bytes)).toBe(true);
    expect(() => base32Decode("1189")).toThrow();
  });

  it("el secreto generado es de 20 bytes y distinto cada vez", () => {
    const a = generateTotpSecret();
    expect(base32Decode(a)).toHaveLength(20);
    expect(a).toMatch(/^[A-Z2-7]{32}$/u);
    expect(generateTotpSecret()).not.toBe(a);
  });

  it("arma el enlace otpauth que leen las apps", () => {
    const uri = otpauthUri({ secret: "ABC234", account: "ana@empresa.com", issuer: "SpiderFolio" });
    expect(uri.startsWith("otpauth://totp/SpiderFolio:ana%40empresa.com?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe("ABC234");
    expect(params.get("issuer")).toBe("SpiderFolio");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });
});

describe("códigos de recuperación", () => {
  it("son 10, distintos, con el formato XXXXX-XXXXX y sin caracteres ambiguos", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/u);
      expect(code).not.toMatch(/[01OIL]/u);
      expect(looksLikeRecoveryCode(code)).toBe(true);
    }
  });

  it("se reconocen escritos a mano y su huella no depende del formato", () => {
    const code = generateRecoveryCode();
    const typed = ` ${code.toLowerCase().replace("-", " ")} `;
    expect(normalizeRecoveryCode(typed)).toBe(normalizeRecoveryCode(code));
    expect(hashRecoveryCode(typed)).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashRecoveryCode(code)).not.toBe(hashRecoveryCode(generateRecoveryCode()));
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });

  it("no tiene sesgo grosero: usa todo el alfabeto", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 400; index++) {
      for (const char of generateRecoveryCode().replace("-", "")) seen.add(char);
    }
    expect(seen.size).toBe(31);
  });
});

describe("cifrado del secreto (MFA_ENCRYPTION_KEY)", () => {
  const key = randomBytes(32).toString("base64");
  const box = createMfaBox({ MFA_ENCRYPTION_KEY: key });

  it("ida y vuelta, con el id de clave al frente y distinto IV cada vez", () => {
    const first = box.encrypt("u1", "SECRETO");
    expect(first.startsWith(`${CURRENT_MFA_KEY_ID}:`)).toBe(true);
    expect(box.decrypt("u1", first)).toBe("SECRETO");
    expect(box.encrypt("u1", "SECRETO")).not.toBe(first);
    expect(box.keyIdOf(first)).toBe(CURRENT_MFA_KEY_ID);
    expect(first).not.toContain("SECRETO");
  });

  it("no descifra en la cuenta de otra persona, alterado, con otra clave ni con id desconocido", () => {
    const sealed = box.encrypt("u1", "SECRETO");
    expect(() => box.decrypt("u2", sealed)).toThrow();
    const parts = sealed.split(":");
    parts[3] = Buffer.from("otro").toString("base64");
    expect(() => box.decrypt("u1", parts.join(":"))).toThrow();
    const other = createMfaBox({ MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
    expect(() => other.decrypt("u1", sealed)).toThrow();
    expect(() => box.decrypt("u1", sealed.replace(/^k1/u, "k9"))).toThrow();
    expect(box.keyIdOf(sealed.replace(/^k1/u, "k9"))).toBeNull();
    expect(() => box.decrypt("u1", `${sealed}:extra`)).toThrow();
  });

  it("exige una clave de 32 bytes", () => {
    expect(() => createMfaBox({ MFA_ENCRYPTION_KEY: undefined })).toThrow();
    expect(() =>
      createMfaBox({ MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow();
  });
});

describe("MFA_ENCRYPTION_KEY en el entorno", () => {
  const good = randomBytes(32).toString("base64");

  it("es opcional fuera de producción y se valida si viene", () => {
    expect(loadEnv({ ...validEnv, MFA_ENCRYPTION_KEY: "" }).MFA_ENCRYPTION_KEY).toBeUndefined();
    expect(loadEnv({ ...validEnv, MFA_ENCRYPTION_KEY: good }).MFA_ENCRYPTION_KEY).toBe(good);
    expect(() => loadEnv({ ...validEnv, MFA_ENCRYPTION_KEY: "corta" })).toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });

  it("es obligatoria en producción, sin mostrar su valor", () => {
    const production = { ...validEnv, NODE_ENV: "production", EMAIL_ALLOW_PRIVATE_HOSTS: "false" };
    expect(() => loadEnv({ ...production, MFA_ENCRYPTION_KEY: "" })).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => loadEnv({ ...production, MFA_ENCRYPTION_KEY: "x".repeat(10) })).not.toThrow(
      /xxxxxxxxxx/,
    );
  });

  it("no puede ser la misma que la del SMTP", () => {
    expect(() =>
      loadEnv({ ...validEnv, EMAIL_ENCRYPTION_KEY: good, MFA_ENCRYPTION_KEY: good }),
    ).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});
