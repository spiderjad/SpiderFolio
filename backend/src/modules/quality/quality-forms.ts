// A form's quality settings (docs/spec/calidad.md, «Desde un registro de formulario»): whether a
// non-conforming record opens a nonconformity by itself, with which severity and who's in charge of it.
// Whoever can edit the form changes them, only while the module is on.
import { z } from "zod";
import { notFound } from "../../lib/errors.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { requireQuality } from "./quality-access.ts";
import { severities } from "./quality.schemas.ts";

export const FormQualitySchema = z.strictObject({
  autoNc: z.boolean(),
  severity: z.enum(severities).nullable(),
  ownerId: z.string().min(1).max(64).nullable(),
});

export type FormQualityInput = z.infer<typeof FormQualitySchema>;

export interface FormQualityView {
  autoNc: boolean;
  severity: FormQualityInput["severity"];
  owner: { id: string; name: string } | null;
}

async function formOf(ctx: AdminContext, id: string): Promise<void> {
  const form = await ctx.db.node.count({ where: { id, type: "FORM", trashedAt: null } });
  if (form === 0) throw notFound();
}

async function viewOf(ctx: AdminContext, nodeId: string): Promise<FormQualityView> {
  const row = await ctx.db.formSettings.findFirst({
    where: { nodeId },
    select: { qualityAutoNc: true, qualitySeverity: true, qualityOwnerId: true },
  });
  const owner =
    row?.qualityOwnerId == null
      ? null
      : await ctx.db.membership.findFirst({
          where: { id: row.qualityOwnerId },
          select: { id: true, user: { select: { name: true } } },
        });
  return {
    autoNc: row?.qualityAutoNc ?? false,
    severity: row?.qualitySeverity ?? null,
    owner: owner === null ? null : { id: owner.id, name: owner.user.name },
  };
}

export async function getFormQuality(ctx: AdminContext, formId: string): Promise<FormQualityView> {
  await requireQuality(ctx);
  await formOf(ctx, formId);
  requireLevel(await levelOfNode(ctx, formId), "VIEW");
  return await viewOf(ctx, formId);
}

export async function saveFormQuality(
  ctx: AdminContext,
  formId: string,
  input: FormQualityInput,
): Promise<FormQualityView> {
  await requireQuality(ctx);
  await formOf(ctx, formId);
  requireLevel(await levelOfNode(ctx, formId), "EDIT");
  if (input.ownerId !== null) {
    const found = await ctx.db.membership.count({
      where: { id: input.ownerId, status: "ACTIVE" },
    });
    if (found === 0) throw notFound();
  }
  const data = {
    qualityAutoNc: input.autoNc,
    qualitySeverity: input.severity,
    qualityOwnerId: input.ownerId,
  };
  await ctx.db.$transaction(async (tx) => {
    const existing = await tx.formSettings.count({ where: { nodeId: formId } });
    if (existing === 0) await tx.formSettings.create({ data: { nodeId: formId, ...data } });
    else await tx.formSettings.updateMany({ where: { nodeId: formId }, data });
  });
  await auditAdmin(ctx, {
    action: "quality.form.settings",
    entityType: "Node",
    entityId: formId,
    metadata: { autoNc: input.autoNc, severity: input.severity, ownerId: input.ownerId },
  });
  return await viewOf(ctx, formId);
}
