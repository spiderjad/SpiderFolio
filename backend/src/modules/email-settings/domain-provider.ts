// Interfaz del proveedor de email para dominios verificados (fase B). El proveedor concreto se
// elige aparte; mientras no haya uno configurado, el modo Dominio muestra «próximamente». El
// correo sale por el proveedor de SpiderFolio con un remitente del dominio del cliente: no hay
// credenciales del cliente.
import type { Env } from "../../config/env.ts";
import type { MailMessage } from "../../lib/mailer.ts";

export interface DnsRecord {
  type: "TXT" | "CNAME" | "MX";
  /** Nombre completo del registro (ej. `selector._domainkey.tudominio.com`). */
  name: string;
  value: string;
  verified: boolean;
}

export interface DomainStatus {
  /** El dominio ya puede enviar (todos los registros requeridos verificados). */
  verified: boolean;
  records: DnsRecord[];
}

export interface DomainMessage extends MailMessage {
  from: { name: string; address: string };
}

export interface EmailDomainProvider {
  readonly id: string;
  /** Alta del dominio; devuelve los registros DNS que el cliente tiene que crear. */
  registerDomain(domain: string): Promise<{ providerRef: string; records: DnsRecord[] }>;
  /** Estado actual: cada registro verificado o no, y si el dominio ya puede enviar. */
  checkDomain(providerRef: string): Promise<DomainStatus>;
  removeDomain(providerRef: string): Promise<void>;
  /** Envía por el proveedor con un remitente del dominio verificado. */
  send(providerRef: string, message: DomainMessage): Promise<void>;
}

export type MemoryDomainProvider = EmailDomainProvider & {
  /** Marca como verificados todos los registros del dominio (solo pruebas). */
  markVerified(providerRef: string): void;
  /** Hace fallar los envíos siguientes (solo pruebas). */
  failSends(fail: boolean): void;
  readonly outbox: readonly { providerRef: string; message: DomainMessage }[];
};

/** Proveedor de prueba, en memoria: no envía nada; sirve para los tests y el desarrollo. */
export function createMemoryDomainProvider(): MemoryDomainProvider {
  const domains = new Map<string, { domain: string; verified: boolean }>();
  const outbox: { providerRef: string; message: DomainMessage }[] = [];
  let failing = false;
  let counter = 0;

  const recordsOf = (domain: string, verified: boolean): DnsRecord[] => [
    { type: "TXT", name: domain, value: "v=spf1 include:spf.memory.test ~all", verified },
    {
      type: "CNAME",
      name: `mem._domainkey.${domain}`,
      value: "mem.dkim.memory.test",
      verified,
    },
  ];

  return {
    id: "memory",
    registerDomain(domain) {
      counter += 1;
      const providerRef = `mem-${String(counter)}`;
      domains.set(providerRef, { domain, verified: false });
      return Promise.resolve({ providerRef, records: recordsOf(domain, false) });
    },
    checkDomain(providerRef) {
      const entry = domains.get(providerRef);
      if (entry === undefined) return Promise.reject(new Error("Dominio desconocido"));
      return Promise.resolve({
        verified: entry.verified,
        records: recordsOf(entry.domain, entry.verified),
      });
    },
    removeDomain(providerRef) {
      domains.delete(providerRef);
      return Promise.resolve();
    },
    send(providerRef, message) {
      if (failing) return Promise.reject(new Error("Fallo simulado"));
      if (!domains.has(providerRef)) return Promise.reject(new Error("Dominio desconocido"));
      outbox.push({ providerRef, message });
      return Promise.resolve();
    },
    markVerified(providerRef) {
      const entry = domains.get(providerRef);
      if (entry !== undefined) entry.verified = true;
    },
    failSends(fail) {
      failing = fail;
    },
    outbox,
  };
}

let memoryProvider: MemoryDomainProvider | undefined;

/** El proveedor del entorno, o null si no hay ninguno (modo Dominio «próximamente»). */
export function domainProviderFromEnv(
  env: Pick<Env, "EMAIL_DOMAIN_PROVIDER">,
): EmailDomainProvider | null {
  if (env.EMAIL_DOMAIN_PROVIDER === "memory") {
    memoryProvider ??= createMemoryDomainProvider();
    return memoryProvider;
  }
  return null;
}
