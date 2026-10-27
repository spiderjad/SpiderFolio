// Conexión SMTP de una empresa: resolución segura del servidor (anti-SSRF), transporte y errores
// limpios. Nunca se devuelve ni se registra el mensaje crudo del servidor: puede repetir el usuario.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import { customEmailTexts } from "../../i18n/index.ts";

export const SMTP_PORTS = [25, 465, 587, 2525] as const;
export type SmtpSecurityMode = "TLS" | "STARTTLS";
export type SmtpErrorCode = keyof typeof customEmailTexts.errors;

/** Servidor inexistente o interno; el mensaje es seguro para mostrar. */
export class SmtpConfigError extends Error {}

const internal = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  internal.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96],
] as const) {
  internal.addSubnet(net, prefix, "ipv6");
}

export function isInternalAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;
  const family = isIP(ip);
  if (family === 0) return true; // lo que no es una IP válida no se acepta
  return internal.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Resuelve el servidor y devuelve la IP a la que se conecta (se conecta a la IP, no al nombre, así
 * un cambio de DNS posterior no sirve para entrar a la red interna). Con `allowPrivate`
 * (desarrollo y tests) se permiten redes internas, como Mailpit.
 */
export async function resolveSmtpHost(host: string, allowPrivate: boolean): Promise<string> {
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((entry) => entry.address);
    } catch {
      throw new SmtpConfigError(customEmailTexts.hostNotFound);
    }
  }
  const first = addresses[0];
  if (first === undefined) throw new SmtpConfigError(customEmailTexts.hostNotFound);
  if (!allowPrivate && addresses.some(isInternalAddress)) {
    throw new SmtpConfigError(customEmailTexts.hostPrivate);
  }
  return first;
}

export interface SmtpConnection {
  host: string;
  port: number;
  security: SmtpSecurityMode;
  user: string | null;
  pass: string | null;
}

export function createSmtpTransport(
  connection: SmtpConnection,
  ip: string,
  allowPrivate: boolean,
): Transporter {
  return nodemailer.createTransport({
    host: ip,
    port: connection.port,
    secure: connection.security === "TLS",
    // Con STARTTLS la conexión debe cifrarse antes de mandar la contraseña (salvo Mailpit local).
    requireTLS: connection.security === "STARTTLS" && !allowPrivate,
    tls: { servername: connection.host },
    ...(connection.user === null
      ? {}
      : { auth: { user: connection.user, pass: connection.pass ?? "" } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Clasifica un fallo de envío sin devolver el texto del servidor. */
export function classifySmtpError(error: unknown): { code: SmtpErrorCode; message: string } {
  const code = classify(error);
  return { code, message: customEmailTexts.errors[code] };
}

const CONNECTION_CODES = [
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "ECONNREFUSED",
  "EDNS",
  "ECONNRESET",
];

function classify(error: unknown): SmtpErrorCode {
  if (typeof error !== "object" || error === null) return "UNKNOWN";
  const { code, responseCode, message } = error as {
    code?: unknown;
    responseCode?: unknown;
    message?: unknown;
  };
  if (code === "EAUTH") return "AUTH";
  if (code === "EENVELOPE") return "SENDER_REJECTED";
  if (typeof responseCode === "number" && [550, 551, 553, 554].includes(responseCode)) {
    return "SENDER_REJECTED";
  }
  if (
    typeof message === "string" &&
    /tls|ssl|certificate|handshake/i.test(message) &&
    (code === "ETLS" || code === "ESOCKET" || code === "ECONNECTION")
  ) {
    return "TLS";
  }
  if (typeof code === "string" && CONNECTION_CODES.includes(code)) return "CONNECTION";
  return "UNKNOWN";
}
