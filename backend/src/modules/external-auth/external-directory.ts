// ctx.directory of the plugins (docs/spec/plugins.md «Directorio de la empresa»): the core applies what
// a company's directory says about its members, inside that company and audited. Accounts are linked by
// the directory's stable id (ExternalIdentity), never by email. The directory never gives nor takes
// the owner role and never suspends an owner, so a company always keeps someone who signs in locally.
import type {
  DirectoryMember,
  DirectorySyncResult,
  LinkedMember,
  PluginDirectory,
} from "@spiderfolio/plugin-sdk/backend";
import { z } from "zod";
import { forTenant, type TenantDb } from "../../db/tenant.ts";
import { directorySignInTexts } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { normalizePersonName } from "../../lib/person-name.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { violatedUniqueIndex } from "../../lib/prisma-errors.ts";
import { audit, auditGlobal } from "../audit/audit.service.ts";
import { EmailSchema } from "../auth/auth.schemas.ts";
import { revokeUserSessions } from "../auth/sessions.service.ts";
import { resolveSeat } from "../members/member-rules.ts";
import { isCapability } from "../roles/capabilities.ts";
import { readDirectoryOnly, readTrustProviderMfa } from "../workspaces/settings.ts";

/** Who the changes are recorded for: the administrator of a plugin route, or nobody (a job). */
export interface DirectoryActor {
  actorId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export const noActor: DirectoryActor = { actorId: null, ip: null, userAgent: null };

const PAGE_SIZE = 100;

const Id = z.string().min(1).max(64);
const ExternalId = z.string().trim().min(1).max(200);

const MemberSchema = z.object({
  externalId: ExternalId,
  email: EmailSchema,
  name: z.string().trim().min(1).max(200).transform(normalizePersonName),
  roleId: Id.optional(),
  departmentIds: z.array(Id).max(200).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
});

export interface DirectoryDeps {
  prisma: PrismaClient;
  workspaceId: string;
  pluginId: string;
  /** The plugin's auth provider ids: `provider` has to be one of them. */
  providers: readonly string[];
  actor: DirectoryActor;
  now?: () => Date;
}

type Role = { id: string; base: "OWNER" | "ADMIN" | "MEMBER" | "GUEST"; capabilities: string[] };

const roleSelect = { id: true, base: true, capabilities: true } as const;

/** Seat for a role, with the same rules as an administrator's change (members/member-rules.ts). */
const seatFor = (role: Role, current: "FULL" | "READER") =>
  resolveSeat({
    current,
    role: { base: role.base, capabilities: role.capabilities.filter(isCapability) },
  });

async function roleFor(db: TenantDb, roleId: string): Promise<Role> {
  const role = await db.role.findFirst({ where: { id: roleId }, select: roleSelect });
  if (role === null || role.base === "OWNER") {
    throw new AppError("BAD_REQUEST", { message: directorySignInTexts.unknownRole });
  }
  return role;
}

async function assertDepartments(db: TenantDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await db.department.count({ where: { id: { in: [...ids] } } });
  if (found !== new Set(ids).size) {
    throw new AppError("BAD_REQUEST", { message: directorySignInTexts.unknownDepartment });
  }
}

export function createPluginDirectory(deps: DirectoryDeps): PluginDirectory {
  const { prisma, workspaceId, pluginId, actor } = deps;
  const db = forTenant(prisma, workspaceId);
  const now = deps.now ?? (() => new Date());

  const assertProvider = (provider: string) => {
    if (!deps.providers.includes(provider)) {
      throw new Error(`El plugin ${pluginId} no declara el proveedor ${provider}`);
    }
  };
  const record = (
    target: TenantDb,
    action: string,
    membershipId: string,
    metadata: Record<string, string | number | boolean | string[]> = {},
  ) =>
    audit(target, {
      ...actor,
      action: `directory.member.${action}`,
      entityType: "Membership",
      entityId: membershipId,
      metadata: { plugin: pluginId, ...metadata },
    });

  async function create(
    provider: string,
    member: z.infer<typeof MemberSchema>,
    role: Role | null,
  ): Promise<DirectorySyncResult> {
    const taken = await prisma.user.findUnique({
      where: { email: member.email },
      select: { id: true },
    });
    if (taken !== null) return { status: "conflict", reason: "emailTaken" };
    const target =
      role ??
      (await db.role.findFirst({ where: { isSystem: true, base: "MEMBER" }, select: roleSelect }));
    if (target === null) throw new Error("El workspace no tiene el rol de sistema Miembro");
    const departmentIds = target.base === "GUEST" ? [] : [...new Set(member.departmentIds ?? [])];
    const at = now();
    try {
      // Users are global: the account, its membership and its link go in one transaction of the base
      // client, with the workspace written explicitly (like accepting an invitation).
      const membershipId = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: member.email, name: member.name, emailVerifiedAt: at },
          select: { id: true },
        });
        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            workspaceId,
            roleId: target.id,
            seatType: seatFor(target, "FULL"),
            jobTitle: member.jobTitle ?? null,
          },
          select: { id: true },
        });
        if (departmentIds.length > 0) {
          await tx.departmentMember.createMany({
            data: departmentIds.map((departmentId) => ({
              departmentId,
              membershipId: membership.id,
              workspaceId,
            })),
          });
        }
        await tx.externalIdentity.create({
          data: {
            workspaceId,
            membershipId: membership.id,
            pluginId,
            provider,
            externalId: member.externalId,
            lastSyncAt: at,
          },
        });
        await auditGlobal(tx, {
          ...actor,
          workspaceId,
          action: "directory.member.create",
          entityType: "Membership",
          entityId: membership.id,
          metadata: {
            plugin: pluginId,
            provider,
            roleId: target.id,
            departments: departmentIds.length,
          },
        });
        return membership.id;
      });
      return { status: "created", membershipId, skipped: [] };
    } catch (error) {
      if (violatedUniqueIndex(error) === "User_email_key") {
        return { status: "conflict", reason: "emailTaken" };
      }
      throw error;
    }
  }

  async function update(
    identity: { id: string; membershipId: string; suspendedByDirectory: boolean },
    member: z.infer<typeof MemberSchema>,
    role: Role | null,
  ): Promise<DirectorySyncResult> {
    const membership = await db.membership.findFirst({
      where: { id: identity.membershipId },
      select: {
        id: true,
        userId: true,
        status: true,
        roleId: true,
        seatType: true,
        jobTitle: true,
        role: { select: roleSelect },
        departments: { select: { departmentId: true } },
      },
    });
    if (membership === null) throw notFound();
    const skipped: ("ownerRole" | "sharedIdentity" | "emailTaken")[] = [];
    const changes: string[] = [];
    const owner = membership.role.base === "OWNER";

    let nextRole = membership.role;
    if (role !== null && role.id !== membership.roleId) {
      if (owner) skipped.push("ownerRole");
      else {
        nextRole = role;
        changes.push("role");
      }
    }
    const seat =
      nextRole.id === membership.roleId
        ? membership.seatType
        : seatFor(nextRole, membership.seatType);
    const current = membership.departments.map((d) => d.departmentId);
    const wanted =
      nextRole.base === "GUEST"
        ? []
        : member.departmentIds === undefined
          ? current
          : [...new Set(member.departmentIds)];
    const leaving = current.filter((id) => !wanted.includes(id));
    const joining = wanted.filter((id) => !current.includes(id));
    if (leaving.length > 0 || joining.length > 0) changes.push("departments");
    const jobTitle =
      member.jobTitle === undefined || member.jobTitle === membership.jobTitle
        ? undefined
        : member.jobTitle;
    if (jobTitle !== undefined) changes.push("jobTitle");
    const reactivate = membership.status === "SUSPENDED" && identity.suspendedByDirectory;

    // Name and email are the account's identity: only while the account is this company's alone
    // (same rule as an administrator's correction).
    const user = await prisma.user.findUnique({
      where: { id: membership.userId },
      select: { name: true, email: true },
    });
    if (user === null) throw notFound();
    const nameChanged = user.name !== member.name;
    const emailChanged = user.email !== member.email;
    if (nameChanged || emailChanged) {
      const elsewhere = await prisma.membership.count({
        where: { userId: membership.userId, NOT: { workspaceId } },
      });
      if (elsewhere > 0) skipped.push("sharedIdentity");
      else {
        try {
          await prisma.user.update({
            where: { id: membership.userId },
            data: {
              ...(nameChanged ? { name: member.name } : {}),
              ...(emailChanged ? { email: member.email, emailVerifiedAt: now() } : {}),
            },
          });
          if (nameChanged) changes.push("name");
          if (emailChanged) {
            changes.push("email");
            await revokeUserSessions(prisma, membership.userId);
          }
        } catch (error) {
          if (violatedUniqueIndex(error) !== "User_email_key") throw error;
          skipped.push("emailTaken");
        }
      }
    }

    await db.$transaction(async (tx) => {
      if (changes.some((c) => c === "role" || c === "jobTitle") || reactivate) {
        await tx.membership.update({
          where: { id: membership.id },
          data: {
            ...(nextRole.id === membership.roleId ? {} : { roleId: nextRole.id, seatType: seat }),
            ...(jobTitle === undefined ? {} : { jobTitle }),
            ...(reactivate ? { status: "ACTIVE" } : {}),
          },
        });
      }
      if (leaving.length > 0) {
        await tx.departmentMember.deleteMany({
          where: { membershipId: membership.id, departmentId: { in: leaving } },
        });
      }
      if (joining.length > 0) {
        await tx.departmentMember.createMany({
          data: joining.map((departmentId) => ({ departmentId, membershipId: membership.id })),
          skipDuplicates: true,
        });
      }
      await tx.externalIdentity.update({
        where: { id: identity.id },
        data: { lastSyncAt: now(), ...(reactivate ? { suspendedByDirectory: false } : {}) },
      });
      if (changes.length > 0) {
        await record(tx, "update", membership.id, {
          changes,
          ...(changes.includes("role") ? { roleId: nextRole.id } : {}),
        });
      }
      if (reactivate) await record(tx, "reactivate", membership.id);
    });
    return {
      status: reactivate ? "reactivated" : changes.length > 0 ? "updated" : "unchanged",
      membershipId: membership.id,
      skipped,
    };
  }

  const findIdentity = (provider: string, externalId: string) =>
    db.externalIdentity.findFirst({
      where: { pluginId, provider, externalId },
      select: { id: true, membershipId: true, suspendedByDirectory: true },
    });

  return {
    async roles() {
      return await db.role.findMany({
        select: { id: true, name: true, base: true },
        orderBy: [{ base: "asc" }, { name: "asc" }],
      });
    },
    async departments() {
      return await db.department.findMany({
        select: { id: true, name: true, parentId: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },
    async syncMember(provider, input: DirectoryMember) {
      assertProvider(provider);
      const member = MemberSchema.parse(input);
      const role = member.roleId === undefined ? null : await roleFor(db, member.roleId);
      if (member.departmentIds !== undefined) await assertDepartments(db, member.departmentIds);
      const identity = await findIdentity(provider, member.externalId);
      return identity === null
        ? await create(provider, member, role)
        : await update(identity, member, role);
    },
    async suspendMember(provider, externalId) {
      assertProvider(provider);
      const identity = await findIdentity(provider, ExternalId.parse(externalId));
      if (identity === null) return "notLinked";
      const membership = await db.membership.findFirst({
        where: { id: identity.membershipId },
        select: { status: true, role: { select: { base: true } } },
      });
      if (membership === null) return "notLinked";
      if (membership.role.base === "OWNER") return "owner";
      if (membership.status === "SUSPENDED") return "unchanged";
      await db.$transaction(async (tx) => {
        // Suspended, the person is out of this company at once (tenantMiddleware requires ACTIVE).
        await tx.membership.update({
          where: { id: identity.membershipId },
          data: { status: "SUSPENDED" },
        });
        await tx.externalIdentity.update({
          where: { id: identity.id },
          data: { suspendedByDirectory: true, lastSyncAt: now() },
        });
        await record(tx, "suspend", identity.membershipId);
      });
      return "suspended";
    },
    async linkedMembers(provider, cursor) {
      assertProvider(provider);
      const rows = await db.externalIdentity.findMany({
        where: {
          pluginId,
          provider,
          ...(cursor === undefined ? {} : { id: { gt: Id.parse(cursor) } }),
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE + 1,
        select: {
          id: true,
          externalId: true,
          suspendedByDirectory: true,
          membership: { select: { id: true, status: true, role: { select: { base: true } } } },
        },
      });
      const page = rows.slice(0, PAGE_SIZE);
      return {
        items: page.map((row): LinkedMember => ({
          membershipId: row.membership.id,
          externalId: row.externalId,
          status: row.membership.status,
          owner: row.membership.role.base === "OWNER",
          suspendedByDirectory: row.suspendedByDirectory,
        })),
        nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },
    async link(provider, membershipId, externalId) {
      assertProvider(provider);
      const id = Id.parse(membershipId);
      const external = ExternalId.parse(externalId);
      const membership = await db.membership.findFirst({ where: { id }, select: { id: true } });
      if (membership === null) throw notFound();
      if ((await db.externalIdentity.count({ where: { membershipId: id } })) > 0) {
        throw new AppError("CONFLICT", { message: directorySignInTexts.memberAlreadyLinked });
      }
      if ((await findIdentity(provider, external)) !== null) {
        throw new AppError("CONFLICT", { message: directorySignInTexts.alreadyLinked });
      }
      await db.$transaction(async (tx) => {
        await tx.externalIdentity.create({
          data: { membershipId: id, pluginId, provider, externalId: external },
        });
        await record(tx, "link", id, { provider });
      });
    },
    async unlink(membershipId) {
      const id = Id.parse(membershipId);
      await db.$transaction(async (tx) => {
        const removed = await tx.externalIdentity.deleteMany({
          where: { membershipId: id, pluginId },
        });
        if (removed.count > 0) await record(tx, "unlink", id);
      });
    },
    async localOwnersWithMfa() {
      return await countLocalOwnersWithMfa(prisma, db);
    },
    async setDirectoryOnly(on) {
      if (on && (await countLocalOwnersWithMfa(prisma, db)) === 0) {
        throw new AppError("CONFLICT", { message: directorySignInTexts.directoryOnlyNeedsOwner });
      }
      const workspace = await db.workspace.findFirstOrThrow({
        where: {},
        select: { id: true, settings: true },
      });
      const holder = readDirectoryOnly(workspace.settings);
      if (on ? holder === pluginId : holder !== pluginId) return;
      const current =
        typeof workspace.settings === "object" && workspace.settings !== null
          ? (workspace.settings as Record<string, unknown>)
          : {};
      await db.workspace.update({
        where: { id: workspace.id },
        data: { settings: { ...current, directoryOnly: on ? pluginId : null } },
      });
      await audit(db, {
        ...actor,
        action: on ? "directory.only.enable" : "directory.only.disable",
        entityType: "Plugin",
        entityId: pluginId,
      });
    },
    async directoryOnly() {
      const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
      return readDirectoryOnly(workspace?.settings) === pluginId;
    },
    async setTrustProviderMfa(on) {
      const workspace = await db.workspace.findFirstOrThrow({
        where: {},
        select: { id: true, settings: true },
      });
      if (readTrustProviderMfa(workspace.settings) === on) return;
      const current =
        typeof workspace.settings === "object" && workspace.settings !== null
          ? (workspace.settings as Record<string, unknown>)
          : {};
      await db.workspace.update({
        where: { id: workspace.id },
        data: { settings: { ...current, directoryTrustMfa: on } },
      });
      await audit(db, {
        ...actor,
        action: on ? "directory.mfa_trust.enable" : "directory.mfa_trust.disable",
        entityType: "Plugin",
        entityId: pluginId,
      });
    },
    async trustProviderMfa() {
      const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
      return readTrustProviderMfa(workspace?.settings);
    },
  };
}

/** Active owners who sign in with their own password (not an empty one) and two-step verification. */
export async function countLocalOwnersWithMfa(prisma: PrismaClient, db: TenantDb): Promise<number> {
  const owners = await db.membership.findMany({
    where: { status: "ACTIVE", role: { base: "OWNER" } },
    select: { userId: true },
  });
  if (owners.length === 0) return 0;
  return await prisma.user.count({
    where: {
      id: { in: owners.map((owner) => owner.userId) },
      kind: "STANDARD",
      passwordHash: { not: null },
      NOT: { passwordHash: "" },
      totpEnabledAt: { not: null },
    },
  });
}
