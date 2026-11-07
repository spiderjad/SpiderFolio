// Turning the occupational health and safety module on or off (docs/spec/seguridad-salud.md,
// «Activación y términos»). The first time it's turned on it creates the module's space and the risk
// assessment document type; on request, the food sector's example positions. Turning it off hides the
// module and never deletes anything.
import { withLocale, readWorkspaceLocale } from "../../i18n/locales.ts";
import { safetyTexts } from "../../i18n/index.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { ensureTypes } from "../documents/documents.service.ts";
import { createForm, saveTemplate } from "../forms/forms.service.ts";
import { createSpace, freeSpaceName } from "../spaces/spaces.service.ts";
import { AppError } from "../../lib/errors.ts";
import { caeTexts } from "../../i18n/index.ts";
import { incidentTemplate } from "./incident-form.ts";
import { ensureCaeRoot } from "./cae-folders.ts";
import { seedDefaultCatalog, seedFoodCatalog } from "./cae-requirements.service.ts";
import { readSafetySettings, type SafetySettings } from "../workspaces/settings.ts";

/** The risk assessment document type (reviewed every 12 months). */
export const RISK_ASSESSMENT_TYPE = "EVR";

export interface SafetyView {
  enabled: boolean;
  terms: SafetySettings["terms"];
  /** The module's space, while it exists. */
  space: { id: string; name: string } | null;
  /** CAE (docs/spec/cae.md): on or off, and its «Contratas» folder while it exists. */
  cae: {
    enabled: boolean;
    folder: { id: string; name: string } | null;
    /** The gatehouse records entries and exits. */
    accessLog: boolean;
  };
}

export interface UpdateSafetyInput {
  enabled?: boolean | undefined;
  terms?: SafetySettings["terms"] | undefined;
  /** Load the food sector's examples that aren't there yet. */
  examples?: boolean | undefined;
  /** CAE on or off (needs the module on). */
  cae?: boolean | undefined;
  /** CAE's gatehouse log on or off. */
  caeAccessLog?: boolean | undefined;
}

async function workspaceOf(ctx: AdminContext) {
  return await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
}

async function spaceOf(ctx: AdminContext, spaceId: string | undefined) {
  if (spaceId === undefined) return null;
  return await ctx.db.space.findFirst({
    where: { id: spaceId },
    select: { id: true, name: true },
  });
}

async function folderOf(ctx: AdminContext, folderId: string | undefined) {
  if (folderId === undefined) return null;
  return await ctx.db.node.findFirst({
    where: { id: folderId, type: "FOLDER", trashedAt: null },
    select: { id: true, name: true },
  });
}

async function viewOf(ctx: AdminContext, settings: SafetySettings): Promise<SafetyView> {
  return {
    enabled: settings.enabled,
    terms: settings.terms,
    space: await spaceOf(ctx, settings.spaceId),
    cae: {
      enabled: settings.cae.enabled,
      folder: await folderOf(ctx, settings.cae.folderId),
      accessLog: settings.cae.accessLog,
    },
  };
}

export async function getSafetySettings(ctx: AdminContext): Promise<SafetyView> {
  return await viewOf(ctx, readSafetySettings((await workspaceOf(ctx)).settings));
}

/**
 * CAE's first activation creates, once, the «Contratas» folder in the module's space and the default
 * catalog with its country's documents; later ones only bring the folder back if it's gone.
 */
async function setUpCae(
  ctx: AdminContext,
  settings: SafetySettings,
  companySettings: unknown,
  examples: boolean,
): Promise<string | undefined> {
  const firstTime = settings.cae.folderId === undefined;
  const folderId = await ensureCaeRoot(ctx, settings, companySettings);
  await withLocale(readWorkspaceLocale(companySettings), async () => {
    if (firstTime) await seedDefaultCatalog(ctx, settings.terms);
    // The food sector's required documents, when asked (never over existing names).
    if (examples) await seedFoodCatalog(ctx, settings.terms);
  });
  return folderId ?? settings.cae.folderId;
}

/** What the module creates, named in the company's language with its terms. */
async function setUp(
  ctx: AdminContext,
  settings: SafetySettings,
  companySettings: unknown,
  examples: boolean,
): Promise<{ spaceId: string; incidentFormId: string }> {
  const texts = withLocale(readWorkspaceLocale(companySettings), () => ({
    space: { ...safetyTexts.space[settings.terms] },
    riskAssessmentType: safetyTexts.riskAssessmentType,
    examplePositions: [...safetyTexts.examplePositions],
    incidentForm: safetyTexts.incidentForm.name,
    incidentFields: incidentTemplate(),
    examplePpe: safetyTexts.examplePpe.map((item) => ({ ...item })),
    inspection: {
      ...safetyTexts.inspectionForm,
      items: [...safetyTexts.inspectionForm.items],
    },
  }));
  let spaceId = (await spaceOf(ctx, settings.spaceId))?.id;
  if (spaceId === undefined) {
    const space = await createSpace(ctx, {
      name: await freeSpaceName(ctx, texts.space.name),
      icon: "🦺",
      description: texts.space.description,
      isPrivate: false,
      isConfidential: false,
      includeSubareas: false,
    });
    spaceId = space.id;
  }
  // The default types first: they're only created while the company has none.
  await ensureTypes(ctx);
  if ((await ctx.db.documentType.count({ where: { code: RISK_ASSESSMENT_TYPE } })) === 0) {
    await ctx.db.documentType.create({
      data: {
        code: RISK_ASSESSMENT_TYPE,
        name: texts.riskAssessmentType,
        prefix: RISK_ASSESSMENT_TYPE,
        reviewMonths: 12,
        position: await ctx.db.documentType.count(),
      },
    });
  }
  if (examples) {
    // Never over what the company already has with the same name.
    await ctx.db.position.createMany({
      skipDuplicates: true,
      data: texts.examplePositions.map((name) => ({ name, nameKey: nameKeyOf(name) })),
    });
    await ctx.db.safetyItem.createMany({
      skipDuplicates: true,
      data: texts.examplePpe.map(({ name, category, hasSizes, lifeMonths }) => ({
        name,
        nameKey: nameKeyOf(name),
        category,
        hasSizes,
        lifeMonths,
        positionIds: [],
      })),
    });
    // The monthly inspection, once (another one with its name in the space: left alone).
    const inspection = await ctx.db.node.count({
      where: { spaceId, type: "FORM", nameKey: nameKeyOf(texts.inspection.name), trashedAt: null },
    });
    if (inspection === 0) {
      const form = await createForm(ctx, spaceId, { name: texts.inspection.name, parentId: null });
      await saveTemplate(ctx, form.node.id, {
        baseVersion: 1,
        fields: [
          {
            id: "revision",
            type: "checklist",
            label: texts.inspection.checks,
            required: true,
            items: texts.inspection.items.map((label, index) => ({
              id: `c${String(index + 1)}`,
              label,
            })),
          },
          {
            id: "observaciones",
            type: "text",
            label: texts.inspection.notes,
            required: false,
            multiline: true,
          },
          { id: "firma", type: "signature", label: texts.inspection.signature, required: true },
        ],
      });
    }
  }
  // The base form to report accidents and incidents, in the module's space.
  let incidentFormId =
    settings.incidentFormId === undefined
      ? undefined
      : (
          await ctx.db.node.findFirst({
            where: { id: settings.incidentFormId, type: "FORM", trashedAt: null },
            select: { id: true },
          })
        )?.id;
  if (incidentFormId === undefined) {
    const form = await createForm(ctx, spaceId, { name: texts.incidentForm, parentId: null });
    await saveTemplate(ctx, form.node.id, { baseVersion: 1, fields: texts.incidentFields });
    incidentFormId = form.node.id;
  }
  return { spaceId, incidentFormId };
}

export async function updateSafetySettings(
  ctx: AdminContext,
  input: UpdateSafetyInput,
): Promise<SafetyView> {
  const workspace = await workspaceOf(ctx);
  const before = readSafetySettings(workspace.settings);
  const after: SafetySettings = {
    enabled: input.enabled ?? before.enabled,
    terms: input.terms ?? before.terms,
    ...(before.spaceId === undefined ? {} : { spaceId: before.spaceId }),
    ...(before.incidentFormId === undefined ? {} : { incidentFormId: before.incidentFormId }),
    cae: {
      ...before.cae,
      enabled: input.cae ?? before.cae.enabled,
      accessLog: input.caeAccessLog ?? before.cae.accessLog,
    },
  };
  if (input.cae === true && !after.enabled) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.moduleOff });
  }
  if (after.enabled) {
    // «examples» with the CAE switch loads only CAE's; with the module (or alone), the module's.
    const moduleExamples =
      input.examples === true && (input.enabled === true || input.cae === undefined);
    const created = await setUp(ctx, after, workspace.settings, moduleExamples);
    after.spaceId = created.spaceId;
    after.incidentFormId = created.incidentFormId;
    if (after.cae.enabled) {
      const folderId = await setUpCae(
        ctx,
        after,
        workspace.settings,
        input.examples === true && input.cae === true,
      );
      after.cae = { ...after.cae, ...(folderId === undefined ? {} : { folderId }) };
    }
  }
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, safety: after } },
  });
  if (after.enabled !== before.enabled) {
    await auditAdmin(ctx, {
      action: after.enabled ? "safety.enable" : "safety.disable",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: { terms: after.terms, examples: input.examples === true },
    });
  } else if (after.terms !== before.terms) {
    await auditAdmin(ctx, {
      action: "safety.terms",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: { before: before.terms, after: after.terms },
    });
  }
  if (after.cae.accessLog !== before.cae.accessLog) {
    await auditAdmin(ctx, {
      action: after.cae.accessLog ? "cae.access_log.enable" : "cae.access_log.disable",
      entityType: "Workspace",
      entityId: workspace.id,
    });
  }
  if (after.cae.enabled !== before.cae.enabled) {
    await auditAdmin(ctx, {
      action: after.cae.enabled ? "cae.enable" : "cae.disable",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: { terms: after.terms },
    });
  }
  return await viewOf(ctx, after);
}
