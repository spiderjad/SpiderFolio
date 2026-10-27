// Importación de miembros desde CSV (CLAUDE.md, sección 9.3): vista previa con validación por
// fila y confirmación que invita a las filas válidas. La confirmación vuelve a validar el CSV en
// el servidor: no se confía en lo que muestre la vista previa.
import { z } from "zod";
import type { SeatType } from "../../generated/prisma/client.ts";
import { AppError } from "../../lib/errors.ts";
import { memberMessages } from "../../i18n/index.ts";
import { EmailSchema } from "../auth/auth.schemas.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import {
  createInvitations,
  defaultSeat,
  type InvitationDeps,
} from "../invitations/invitations.service.ts";
import { isCapability, type Capability } from "../roles/capabilities.ts";
import { baseRank, isAdministrative, missingCapabilities } from "../roles/role-rules.ts";
import { MAX_IMPORT_ROWS, parseCsv, readImportRows, type RawImportRow } from "./members.csv.ts";

export type RowReason =
  | "invalid_email"
  | "duplicate_in_file"
  | "unknown_role"
  | "role_not_allowed"
  | "unknown_department"
  | "guest_departments"
  | "invalid_seat"
  | "domain_not_allowed"
  | "already_member"
  | "already_invited";

export interface ImportRowResult {
  line: number;
  email: string;
  /** ok: se invita; skip: ya estaba; error: hay que corregir la fila. */
  status: "ok" | "skip" | "error";
  reason?: RowReason;
  roleId?: string;
  roleName?: string;
  seatType?: SeatType;
  departmentIds?: string[];
}

export interface ImportPreview {
  rows: ImportRowResult[];
  summary: { ok: number; skip: number; error: number };
}

const emailCheck = z.string().pipe(EmailSchema);

function parseRows(csv: string): RawImportRow[] {
  const rows = readImportRows(parseCsv(csv));
  if (rows === null)
    throw new AppError("BAD_REQUEST", { message: memberMessages.csvNoEmailColumn });
  if (rows.length === 0) throw new AppError("BAD_REQUEST", { message: memberMessages.csvEmpty });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new AppError("BAD_REQUEST", { message: memberMessages.csvTooLarge });
  }
  return rows;
}

export async function previewImport(
  ctx: AdminContext,
  deps: InvitationDeps,
  csv: string,
): Promise<ImportPreview> {
  const raw = parseRows(csv);
  const now = new Date();

  const [roles, departments, pending] = await Promise.all([
    ctx.db.role.findMany({ select: { id: true, name: true, base: true, capabilities: true } }),
    ctx.db.department.findMany({ select: { id: true, name: true } }),
    ctx.db.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { email: true },
    }),
  ]);
  const roleByName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));
  const defaultRole = roles.find((r) => r.base === "MEMBER" && r.capabilities.length === 0);
  const departmentByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const pendingEmails = new Set(pending.map((p) => p.email));

  const emails = raw.flatMap((r) => {
    const parsed = emailCheck.safeParse(r.email);
    return parsed.success ? [parsed.data] : [];
  });
  const users =
    emails.length === 0
      ? []
      : await deps.prisma.user.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        });
  const memberships =
    users.length === 0
      ? []
      : await ctx.db.membership.findMany({
          where: { userId: { in: users.map((u) => u.id) } },
          select: { userId: true },
        });
  const memberIds = new Set(memberships.map((m) => m.userId));
  const memberEmails = new Set(users.filter((u) => memberIds.has(u.id)).map((u) => u.email));
  // Emails que rechaza algún plugin activo (ej. dominios permitidos); no aplica a invitados externos.
  const rejected = new Set(
    (
      await Promise.all(
        [...new Set(emails)].map(async (email) =>
          (await deps.plugins.checkMemberEmail(ctx.db.workspaceId, email)) === null ? [] : [email],
        ),
      )
    ).flat(),
  );

  const seen = new Set<string>();
  const rows: ImportRowResult[] = raw.map((row): ImportRowResult => {
    const fail = (reason: RowReason, email = row.email): ImportRowResult => ({
      line: row.line,
      email,
      status: "error",
      reason,
    });
    const parsed = emailCheck.safeParse(row.email);
    if (!parsed.success) return fail("invalid_email");
    const email = parsed.data;
    if (seen.has(email)) return fail("duplicate_in_file", email);
    seen.add(email);

    const role = row.role === "" ? defaultRole : roleByName.get(row.role.toLowerCase());
    if (role === undefined) return fail("unknown_role", email);
    const caps: Capability[] = role.capabilities.filter(isCapability);
    if (
      role.base === "OWNER" ||
      baseRank[role.base] > baseRank[ctx.actor.base] ||
      missingCapabilities(ctx.actor, caps).length > 0
    ) {
      return fail("role_not_allowed", email);
    }

    if (row.seat !== "" && row.seat !== "FULL" && row.seat !== "READER") {
      return fail("invalid_seat", email);
    }
    const requested = row.seat === "" ? undefined : row.seat;
    const seatType = requested ?? defaultSeat(role.base);
    if (
      (role.base === "GUEST" && seatType !== "READER") ||
      (seatType === "READER" && isAdministrative({ capabilities: caps }))
    ) {
      return fail("invalid_seat", email);
    }

    const departmentIds: string[] = [];
    for (const name of row.departments) {
      const id = departmentByName.get(name.toLowerCase());
      if (id === undefined) return fail("unknown_department", email);
      departmentIds.push(id);
    }
    if (role.base === "GUEST" && departmentIds.length > 0) return fail("guest_departments", email);

    if (role.base !== "GUEST" && rejected.has(email)) {
      return fail("domain_not_allowed", email);
    }

    if (memberEmails.has(email)) {
      return { line: row.line, email, status: "skip", reason: "already_member" };
    }
    if (pendingEmails.has(email)) {
      return { line: row.line, email, status: "skip", reason: "already_invited" };
    }
    return {
      line: row.line,
      email,
      status: "ok",
      roleId: role.id,
      roleName: role.name,
      seatType,
      departmentIds: [...new Set(departmentIds)],
    };
  });

  return {
    rows,
    summary: {
      ok: rows.filter((r) => r.status === "ok").length,
      skip: rows.filter((r) => r.status === "skip").length,
      error: rows.filter((r) => r.status === "error").length,
    },
  };
}

/** Invita a las filas válidas. Las demás se informan igual que en la vista previa. */
export async function confirmImport(
  ctx: AdminContext,
  deps: InvitationDeps,
  csv: string,
): Promise<ImportPreview & { invited: number }> {
  const preview = await previewImport(ctx, deps, csv);
  const valid = preview.rows.filter(
    (r): r is ImportRowResult & { roleId: string; seatType: SeatType; departmentIds: string[] } =>
      r.status === "ok" &&
      r.roleId !== undefined &&
      r.seatType !== undefined &&
      r.departmentIds !== undefined,
  );

  const groups = new Map<
    string,
    { roleId: string; seatType: SeatType; departmentIds: string[]; emails: string[] }
  >();
  for (const row of valid) {
    const departmentIds = [...row.departmentIds].sort();
    const key = `${row.roleId}|${row.seatType}|${departmentIds.join(",")}`;
    const group = groups.get(key) ?? {
      roleId: row.roleId,
      seatType: row.seatType,
      departmentIds,
      emails: [],
    };
    group.emails.push(row.email);
    groups.set(key, group);
  }

  let invited = 0;
  for (const group of groups.values()) {
    const result = await createInvitations(ctx, deps, {
      emails: group.emails,
      roleId: group.roleId,
      seatType: group.seatType,
      departmentIds: group.departmentIds,
    });
    invited += result.invitations.length;
  }
  return { ...preview, invited };
}
