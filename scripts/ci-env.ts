// Writes the .env the CI's tests use: .env.example with fresh random secrets on every run (nothing fixed
// in the workflows) and the S3 keys of the run's RustFS service, from the environment.
//   S3_ACCESS_KEY=… S3_SECRET_KEY=… node scripts/ci-env.ts
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const values: Record<string, string> = {
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  SEED_DEMO_PASSWORD: randomBytes(12).toString("hex"),
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "",
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "",
  // Gotenberg runs as a service on the runner.
  GOTENBERG_URL: "http://127.0.0.1:3000",
};
for (const name of ["S3_ACCESS_KEY", "S3_SECRET_KEY"]) {
  if (values[name] === "") throw new Error(`Falta ${name} en el entorno`);
}

const lines = readFileSync(".env.example", "utf8")
  .split(/\r?\n/u)
  .map((line) => {
    const name = /^([A-Z0-9_]+)=/u.exec(line)?.[1];
    return name !== undefined && name in values ? `${name}=${values[name] ?? ""}` : line;
  });
writeFileSync(".env", lines.join("\n"));
console.log(`.env listo (${String(Object.keys(values).length)} valores del CI)`);
