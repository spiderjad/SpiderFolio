// webServer de los E2E: sirve el build de producción (dist/) con la CSP estricta y reenvía
// /api a la API, como Caddy en producción (sección 15).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { cspHeader, storageOriginFromEnv } from "../csp.ts";
import { E2E_API_PORT, E2E_WEB_PORT } from "./config.ts";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};
const SECURITY_HEADERS = {
  "Content-Security-Policy": cspHeader(storageOriginFromEnv(process.env)),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function clientIp(header: string | string[] | undefined, remote: string | undefined): string {
  return typeof header === "string" && /^[0-9.]+$/.test(header) ? header : (remote ?? "");
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const upstream = request(
      {
        host: "127.0.0.1",
        port: E2E_API_PORT,
        path: req.url,
        method: req.method,
        // Como Caddy, este proxy es el salto de confianza que fija la IP del cliente. En los
        // E2E, cada test simula su propio cliente con x-e2e-client-ip, así los rate limits por
        // IP no se pisan entre tests (la app no tiene ningún bypass).
        headers: {
          ...req.headers,
          "x-forwarded-for": clientIp(req.headers["x-e2e-client-ip"], req.socket.remoteAddress),
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502).end();
    });
    req.pipe(upstream);
    return;
  }
  const candidate = normalize(join(dist, decodeURIComponent(url.pathname)));
  const file =
    candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(dist, "index.html");
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
}).listen(E2E_WEB_PORT);
