// webServer de los E2E: recrea la base spiderfolio_e2e y levanta API y worker con ese entorno.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { e2eBackendEnv } from "./env.ts";

const backendDir = fileURLToPath(new URL("../../backend", import.meta.url));
const env = e2eBackendEnv();

execFileSync(process.execPath, ["scripts/prepare-db.ts"], {
  cwd: backendDir,
  env,
  stdio: "inherit",
});

const children = ["src/server.ts", "src/worker.ts"].map((entry) =>
  spawn(process.execPath, [entry], { cwd: backendDir, env, stdio: "inherit" }),
);
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const child of children) {
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Un proceso del backend terminó con código ${String(code)}`);
      stop();
    }
  });
}
