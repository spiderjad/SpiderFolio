// Acciones masivas sobre miembros (CLAUDE.md, sección 9.3): cada persona pasa por las mismas
// reglas que la acción individual; el resultado es por persona, nunca todo o nada.
import { AppError, type ErrorCode } from "../../lib/errors.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertGlobalManager } from "../people/people-scope.ts";
import type { BulkMembersInput } from "./members.schemas.ts";
import {
  getMember,
  reactivateMember,
  suspendMember,
  updateMember,
  type MemberDeps,
} from "./members.service.ts";

export type BulkOutcome =
  { id: string; ok: true } | { id: string; ok: false; code: ErrorCode; message: string };

export async function bulkMembers(
  ctx: AdminContext,
  deps: MemberDeps,
  input: BulkMembersInput,
): Promise<{ results: BulkOutcome[]; succeeded: number; failed: number }> {
  await assertGlobalManager(ctx);
  const { action } = input;
  const results: BulkOutcome[] = [];
  for (const id of input.ids) {
    try {
      switch (action.type) {
        case "change_role":
          await updateMember(ctx, deps, id, { roleId: action.roleId });
          break;
        case "change_seat":
          await updateMember(ctx, deps, id, { seatType: action.seatType });
          break;
        case "change_departments": {
          const current = (await getMember(ctx, id)).departments.map((d) => d.id);
          const next =
            action.mode === "set"
              ? action.departmentIds
              : action.mode === "add"
                ? [...new Set([...current, ...action.departmentIds])]
                : current.filter((d) => !action.departmentIds.includes(d));
          await updateMember(ctx, deps, id, { departmentIds: next });
          break;
        }
        case "suspend":
          await suspendMember(ctx, id);
          break;
        case "reactivate":
          await reactivateMember(ctx, deps, id);
          break;
      }
      results.push({ id, ok: true });
    } catch (error) {
      // Los errores de negocio se informan por persona; cualquier otro corta el lote.
      if (!(error instanceof AppError)) throw error;
      results.push({ id, ok: false, code: error.code, message: error.message });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  await auditAdmin(ctx, {
    action: "member.bulk",
    entityType: "Membership",
    metadata: { type: action.type, requested: input.ids.length, succeeded },
  });
  return { results, succeeded, failed: results.length - succeeded };
}
