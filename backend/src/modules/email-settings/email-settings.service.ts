// Remitente de email propio (Seguridad › Email). La contraseña SMTP se guarda cifrada y no sale
// nunca: la API solo dice si hay una. Para activar hace falta una prueba aprobada de esta misma
// configuración (huella con clave: cambiar cualquier dato la invalida).
import type { Env } from "../../config/env.ts";
import { renderEmail } from "../../emails/layout.ts";
import { Prisma, type WorkspaceEmail } from "../../generated/prisma/client.ts";
import type { DnsRecord, EmailDomainProvider } from "./domain-provider.ts";
import { customEmailTexts } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { SecretBox } from "../../lib/secret-box.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import type { UpdateEmailSettingsInput } from "./email-settings.schemas.ts";
import {
  classifySmtpError,
  createSmtpTransport,
  resolveSmtpHost,
  SmtpConfigError,
  type SmtpConnection,
} from "./smtp.ts";

export interface EmailSettingsDeps {
  env: Pick<Env, "EMAIL_ALLOW_PRIVATE_HOSTS">;
  prisma: PrismaClient;
  /** null: el servidor no tiene EMAIL_ENCRYPTION_KEY (solo desarrollo). */
  box: SecretBox | null;
  /** null: no hay proveedor de dominios configurado (modo Dominio «próximamente»). */
  domainProvider: EmailDomainProvider | null;
}

export interface DomainView {
  name: string;
  /** PENDING hasta que el proveedor verifica todos los registros. */
  status: "PENDING" | "VERIFIED";
  records: DnsRecord[];
  verifiedAt: Date | null;
}

export interface EmailSettingsView {
  /** El plan incluye la función. */
  included: boolean;
  /** El servidor puede guardar secretos (hay clave de cifrado). */
  available: boolean;
  /** Hay un proveedor para el modo Dominio. */
  domainAvailable: boolean;
  config: {
    domain: DomainView | null;
    mode: WorkspaceEmail["mode"];
    status: WorkspaceEmail["status"];
    fromName: string | null;
    fromEmail: string | null;
    replyTo: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecurity: WorkspaceEmail["smtpSecurity"];
    smtpUser: string | null;
    hasPassword: boolean;
    /** La configuración actual pasó la prueba. */
    tested: boolean;
    testedAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
    lastFallbackAlertAt: Date | null;
  } | null;
}

export interface TestResult {
  ok: boolean;
  code?: string;
  message?: string;
}

function requireBox(deps: EmailSettingsDeps): SecretBox {
  if (deps.box === null)
    throw new AppError("UNAVAILABLE", { message: customEmailTexts.keyMissing });
  return deps.box;
}

/** Datos de conexión de la fila (descifra la contraseña); null si la configuración está incompleta. */
export function connectionOf(box: SecretBox, row: WorkspaceEmail): SmtpConnection | null {
  if (row.smtpHost === null || row.smtpPort === null) return null;
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    security: row.smtpSecurity,
    user: row.smtpUser,
    pass: row.smtpPassEnc === null ? null : box.decrypt(row.workspaceId, row.smtpPassEnc),
  };
}

/** Huella de lo que la prueba valida: servidor, puerto, seguridad, usuario, contraseña y remitente. */
export function fingerprintOf(box: SecretBox, row: WorkspaceEmail): string | null {
  if (row.mode === "DOMAIN") {
    if (row.domain === null || row.domainProviderRef === null || row.fromEmail === null) {
      return null;
    }
    return box.mac(
      row.workspaceId,
      JSON.stringify(["domain", row.domain, row.domainProviderRef, row.fromEmail]),
    );
  }
  const connection = connectionOf(box, row);
  if (connection === null || row.fromEmail === null) return null;
  return box.mac(
    row.workspaceId,
    JSON.stringify([
      connection.host,
      connection.port,
      connection.security,
      connection.user,
      connection.pass,
      row.fromEmail,
    ]),
  );
}

function isTested(box: SecretBox | null, row: WorkspaceEmail): boolean {
  if (box === null || row.testedFingerprint === null) return false;
  try {
    return fingerprintOf(box, row) === row.testedFingerprint;
  } catch {
    return false;
  }
}

function domainViewOf(row: WorkspaceEmail): DomainView | null {
  if (row.domain === null) return null;
  return {
    name: row.domain,
    status: row.domainStatus === "VERIFIED" ? "VERIFIED" : "PENDING",
    records: Array.isArray(row.domainRecords) ? (row.domainRecords as unknown as DnsRecord[]) : [],
    verifiedAt: row.domainVerifiedAt,
  };
}

function view(
  row: WorkspaceEmail | null,
  deps: EmailSettingsDeps,
  included: boolean,
): EmailSettingsView {
  return {
    included,
    available: deps.box !== null,
    domainAvailable: deps.domainProvider !== null,
    config:
      row === null
        ? null
        : {
            domain: domainViewOf(row),
            mode: row.mode,
            status: row.status,
            fromName: row.fromName,
            fromEmail: row.fromEmail,
            replyTo: row.replyTo,
            smtpHost: row.smtpHost,
            smtpPort: row.smtpPort,
            smtpSecurity: row.smtpSecurity,
            smtpUser: row.smtpUser,
            hasPassword: row.smtpPassEnc !== null,
            tested: isTested(deps.box, row),
            testedAt: row.testedAt,
            lastError: row.lastError,
            lastErrorAt: row.lastErrorAt,
            lastFallbackAlertAt: row.lastFallbackAlertAt,
          },
  };
}

async function currentRow(ctx: AdminContext): Promise<WorkspaceEmail | null> {
  return ctx.db.workspaceEmail.findFirst({ where: {} });
}

export async function getEmailSettings(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
): Promise<EmailSettingsView> {
  // El remitente propio es del núcleo: siempre disponible.
  return view(await currentRow(ctx), deps, true);
}

async function safeIp(host: string, deps: EmailSettingsDeps): Promise<string> {
  try {
    return await resolveSmtpHost(host, deps.env.EMAIL_ALLOW_PRIVATE_HOSTS);
  } catch (error) {
    if (error instanceof SmtpConfigError) {
      throw new AppError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
}

const CONFIG_FIELDS = [
  "fromName",
  "fromEmail",
  "replyTo",
  "smtpHost",
  "smtpPort",
  "smtpSecurity",
  "smtpUser",
] as const;

export async function updateEmailSettings(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
  input: UpdateEmailSettingsInput,
): Promise<EmailSettingsView> {
  const box = requireBox(deps);
  const existing = await currentRow(ctx);
  await safeIp(input.smtpHost, deps);

  const workspaceId = ctx.tenant.workspaceId;
  // Sin usuario no hay contraseña; con usuario nuevo y sin contraseña guardada, hace falta una.
  const smtpPassEnc =
    input.smtpUser === null
      ? null
      : input.smtpPass !== undefined
        ? box.encrypt(workspaceId, input.smtpPass)
        : (existing?.smtpPassEnc ?? null);
  if (input.smtpUser !== null && smtpPassEnc === null) {
    throw new AppError("VALIDATION_ERROR", { message: customEmailTexts.needsPassword });
  }

  const data = {
    mode: "SMTP" as const,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecurity: input.smtpSecurity,
    smtpUser: input.smtpUser,
    smtpPassEnc,
  };
  const changed = CONFIG_FIELDS.filter(
    (field) => existing === null || existing[field] !== data[field],
  );
  const passwordChanged =
    input.smtpPass !== undefined || (existing?.smtpUser ?? null) !== input.smtpUser;

  const saved =
    existing === null
      ? await ctx.db.workspaceEmail.create({ data: { ...data, status: "DRAFT" } })
      : await ctx.db.workspaceEmail.update({ where: { id: existing.id }, data });
  // Si lo que se probó ya no es lo guardado, vuelve a borrador (hay que probar de nuevo).
  const status = isTested(box, saved) ? saved.status : "DRAFT";
  const final =
    status === saved.status
      ? saved
      : await ctx.db.workspaceEmail.update({ where: { id: saved.id }, data: { status } });

  await auditAdmin(ctx, {
    action: "email.config_updated",
    entityType: "WorkspaceEmail",
    entityId: final.id,
    metadata: { changed: [...changed], passwordChanged, status: final.status },
  });
  return view(final, deps, true);
}

export async function sendTestEmail(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
  userId: string,
): Promise<{ result: TestResult; settings: EmailSettingsView }> {
  const box = requireBox(deps);
  const row = await currentRow(ctx);
  if (row === null || row.fromEmail === null || row.fromName === null) {
    throw new AppError("BAD_REQUEST", { message: customEmailTexts.incomplete });
  }
  const sender = { name: row.fromName, address: row.fromEmail };
  // Solo al email de quien lo pide.
  const recipient = await deps.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  if (recipient.email === null) {
    throw new AppError("BAD_REQUEST", { message: customEmailTexts.noRecipient });
  }
  const workspace = await ctx.db.workspace.findFirstOrThrow({ where: {}, select: { name: true } });

  const content = renderEmail({
    subject: customEmailTexts.test.subject,
    title: customEmailTexts.test.title,
    paragraphs: [customEmailTexts.test.body(workspace.name)],
  });
  const message = {
    to: recipient.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    ...(row.replyTo === null ? {} : { replyTo: row.replyTo }),
  };
  let result: TestResult;
  try {
    if (row.mode === "DOMAIN") {
      if (
        deps.domainProvider === null ||
        row.domainProviderRef === null ||
        row.domainStatus !== "VERIFIED"
      ) {
        throw new AppError("BAD_REQUEST", { message: customEmailTexts.domainNotVerified });
      }
      await deps.domainProvider.send(row.domainProviderRef, { ...message, from: sender });
    } else {
      const connection = connectionOf(box, row);
      if (connection === null) {
        throw new AppError("BAD_REQUEST", { message: customEmailTexts.incomplete });
      }
      const ip = await safeIp(connection.host, deps);
      const transport = createSmtpTransport(connection, ip, deps.env.EMAIL_ALLOW_PRIVATE_HOSTS);
      try {
        await transport.sendMail({ from: sender, ...message });
      } finally {
        transport.close();
      }
    }
    result = { ok: true };
  } catch (error) {
    result =
      error instanceof AppError
        ? { ok: false, code: "CONFIG", message: error.message }
        : { ok: false, ...classifySmtpError(error) };
  }

  const saved = await ctx.db.workspaceEmail.update({
    where: { id: row.id },
    data: result.ok
      ? {
          testedFingerprint: fingerprintOf(box, row),
          testedAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        }
      : { lastError: result.message ?? null, lastErrorAt: new Date() },
  });
  await auditAdmin(ctx, {
    action: "email.test_sent",
    entityType: "WorkspaceEmail",
    entityId: row.id,
    metadata: { ok: result.ok, ...(result.code === undefined ? {} : { code: result.code }) },
  });
  return { result, settings: view(saved, deps, true) };
}

export async function activateEmail(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
): Promise<EmailSettingsView> {
  const box = requireBox(deps);
  const row = await currentRow(ctx);
  if (row === null) {
    throw new AppError("BAD_REQUEST", { message: customEmailTexts.incomplete });
  }
  if (row.mode === "DOMAIN" && row.domainStatus !== "VERIFIED") {
    throw new AppError("CONFLICT", { message: customEmailTexts.domainNotVerified });
  }
  if (!isTested(box, row)) {
    throw new AppError("CONFLICT", { message: customEmailTexts.notTested });
  }
  const saved = await ctx.db.workspaceEmail.update({
    where: { id: row.id },
    data: { status: "ACTIVE", consecutiveFailures: 0 },
  });
  await auditAdmin(ctx, {
    action: "email.activated",
    entityType: "WorkspaceEmail",
    entityId: row.id,
  });
  return view(saved, deps, true);
}

export async function deactivateEmail(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
): Promise<EmailSettingsView> {
  // El remitente propio es del núcleo: siempre disponible.
  const included = true;
  const row = await currentRow(ctx);
  if (row === null) return view(null, deps, included);
  const saved = await ctx.db.workspaceEmail.update({
    where: { id: row.id },
    data: { status: "DISABLED" },
  });
  await auditAdmin(ctx, {
    action: "email.deactivated",
    entityType: "WorkspaceEmail",
    entityId: row.id,
  });
  return view(saved, deps, included);
}

const DOMAIN_NAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function requireProvider(deps: EmailSettingsDeps): EmailDomainProvider {
  if (deps.domainProvider === null) {
    throw new AppError("UNAVAILABLE", { message: customEmailTexts.domainSoon });
  }
  return deps.domainProvider;
}

/** Alta del dominio en el proveedor: devuelve los registros DNS que el cliente tiene que crear. */
export async function registerEmailDomain(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
  input: { domain: string; fromName: string; fromLocalPart: string; replyTo: string | null },
): Promise<EmailSettingsView> {
  requireBox(deps);
  const provider = requireProvider(deps);
  const domain = input.domain.trim().toLowerCase();
  if (!DOMAIN_NAME.test(domain)) {
    throw new AppError("VALIDATION_ERROR", { message: customEmailTexts.invalidDomain });
  }
  const existing = await currentRow(ctx);
  // Mismo dominio ya dado de alta: no se vuelve a registrar, solo cambia el remitente.
  const reuse = existing?.domain === domain && existing.domainProviderRef !== null;
  const registered = reuse ? null : await provider.registerDomain(domain);
  if (!reuse && existing?.domainProviderRef != null) {
    await provider.removeDomain(existing.domainProviderRef).catch(() => undefined);
  }
  const data = {
    mode: "DOMAIN" as const,
    fromName: input.fromName,
    fromEmail: `${input.fromLocalPart}@${domain}`,
    replyTo: input.replyTo,
    ...(registered === null
      ? {}
      : {
          domain,
          domainProviderRef: registered.providerRef,
          domainStatus: "PENDING",
          domainRecords: registered.records as unknown as Prisma.InputJsonValue,
          domainVerifiedAt: null,
        }),
  };
  const saved =
    existing === null
      ? await ctx.db.workspaceEmail.create({ data: { ...data, status: "DRAFT" } })
      : await ctx.db.workspaceEmail.update({ where: { id: existing.id }, data });
  const final = isTested(deps.box, saved)
    ? saved
    : await ctx.db.workspaceEmail.update({ where: { id: saved.id }, data: { status: "DRAFT" } });
  await auditAdmin(ctx, {
    action: "email.domain_registered",
    entityType: "WorkspaceEmail",
    entityId: final.id,
    metadata: { domain, provider: provider.id },
  });
  return view(final, deps, true);
}

/** Consulta al proveedor qué registros ya están verificados. */
export async function verifyEmailDomain(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
): Promise<EmailSettingsView> {
  const provider = requireProvider(deps);
  const row = await currentRow(ctx);
  if (row === null || row.domainProviderRef === null) {
    throw new AppError("BAD_REQUEST", { message: customEmailTexts.incomplete });
  }
  const status = await provider.checkDomain(row.domainProviderRef);
  const saved = await ctx.db.workspaceEmail.update({
    where: { id: row.id },
    data: {
      domainStatus: status.verified ? "VERIFIED" : "PENDING",
      domainRecords: status.records as unknown as Prisma.InputJsonValue,
      domainVerifiedAt: status.verified ? (row.domainVerifiedAt ?? new Date()) : null,
      // Si dejó de estar verificado, el remitente propio deja de usarse.
      ...(status.verified || row.status !== "ACTIVE" || row.mode !== "DOMAIN"
        ? {}
        : { status: "DISABLED" as const }),
    },
  });
  await auditAdmin(ctx, {
    action: "email.domain_checked",
    entityType: "WorkspaceEmail",
    entityId: row.id,
    metadata: { verified: status.verified },
  });
  return view(saved, deps, true);
}

/** Quita el dominio (también del proveedor) y vuelve al modo SMTP, sin activar. */
export async function removeEmailDomain(
  ctx: AdminContext,
  deps: EmailSettingsDeps,
): Promise<EmailSettingsView> {
  // El remitente propio es del núcleo: siempre disponible.
  const included = true;
  const row = await currentRow(ctx);
  if (row === null || row.domain === null) return view(row, deps, included);
  if (row.domainProviderRef !== null && deps.domainProvider !== null) {
    await deps.domainProvider.removeDomain(row.domainProviderRef).catch(() => undefined);
  }
  const saved = await ctx.db.workspaceEmail.update({
    where: { id: row.id },
    data: {
      domain: null,
      domainProviderRef: null,
      domainStatus: null,
      domainRecords: Prisma.DbNull,
      domainVerifiedAt: null,
      ...(row.mode === "DOMAIN" ? { mode: "SMTP" as const, status: "DISABLED" as const } : {}),
    },
  });
  await auditAdmin(ctx, {
    action: "email.domain_removed",
    entityType: "WorkspaceEmail",
    entityId: row.id,
  });
  return view(saved, deps, included);
}
