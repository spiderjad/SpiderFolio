// webServer de los E2E: sirve dist/ (HTML estático) con la CSP estricta de web/csp.ts, como Caddy.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { cspHeader } from "../csp.ts";
import { E2E_WEB_PORT } from "./config.ts";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};
const HEADERS = {
  "Content-Security-Policy": cspHeader(),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function resolveFile(pathname: string): { file: string; status: number } {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const target = join(dist, clean);
  // Nada fuera de dist/.
  if (!target.startsWith(dist)) return { file: join(dist, "404.html"), status: 404 };
  for (const candidate of [target, join(target, "index.html"), `${target}.html`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { file: candidate, status: 200 };
    }
  }
  return { file: join(dist, "404.html"), status: 404 };
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const { file, status } = resolveFile(pathname);
  res.writeHead(status, {
    ...HEADERS,
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
}).listen(E2E_WEB_PORT, "127.0.0.1");
