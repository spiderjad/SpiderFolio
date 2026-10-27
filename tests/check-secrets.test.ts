import { describe, expect, it } from "vitest";
import { forbiddenFile, scanText } from "../scripts/check-secrets.ts";

// Los valores falsos se arman por partes: este archivo también lo revisa el escáner.
const fake = {
  anthropic: ["sk", "ant", "a".repeat(40)].join("-"),
  stripe: ["sk_live_", "b".repeat(24)].join(""),
  aws: ["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
  github: ["ghp_", "c".repeat(36)].join(""),
  privateKey: ["-----BEGIN ", "RSA PRIVATE KEY", "-----"].join(""),
};

describe("verificación de secretos", () => {
  it("detecta claves con forma conocida y nombra la regla sin repetir el valor", () => {
    for (const value of Object.values(fake)) {
      const found = scanText("src/config.ts", `const x = "${value}";`);
      expect(found).toHaveLength(1);
      expect(JSON.stringify(found)).not.toContain(value);
    }
  });

  it("deja pasar claves de prueba, marcadores y texto normal", () => {
    expect(scanText("a.ts", 'const k = "sk_test_' + "d".repeat(24) + '";')).toEqual([]);
    expect(scanText("a.ts", `const k = "${fake.anthropic}"; // secret-scan:allow`)).toEqual([]);
    expect(scanText("a.ts", `const nombre = '${["sk", "ant", ""].join("-")}'; // prefijo`)).toEqual(
      [],
    );
    expect(scanText("package-lock.json", fake.aws)).toEqual([]);
  });

  it(".env.example: los secretos van vacíos; el resto puede tener valor", () => {
    expect(scanText(".env.example", "ANTHROPIC_API_KEY=algo")).toHaveLength(1);
    expect(scanText(".env.example", "SMTP_PASS=algo   # comentario")).toHaveLength(1);
    expect(scanText(".env.example", "ANTHROPIC_API_KEY=      # vacía")).toEqual([]);
    expect(scanText(".env.example", "EMAIL_ALLOW_PRIVATE_HOSTS=true")).toEqual([]);
    expect(scanText(".env.example", "EMAIL_ENCRYPTION_KEY=valorDeDesarrollo")).toEqual([]);
    expect(scanText(".env", "ANTHROPIC_API_KEY=algo")).toEqual([]);
  });

  it("un .env versionado es un error; .env.example no", () => {
    expect(forbiddenFile(".env")).not.toBeNull();
    expect(forbiddenFile("backend/.env.local")).not.toBeNull();
    expect(forbiddenFile(".env.example")).toBeNull();
  });
});
