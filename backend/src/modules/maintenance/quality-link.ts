// Quality ↔ Maintenance (docs/spec/mantenimiento.md, section 8). A monitoring record out of its limits
// (the cold room at 9 °C, the dryer off its curve) opens a nonconformity; if the record names a piece of
// equipment, maintenance gets an urgent work order for it, linked to the NC. The equipment is named by
// the record itself: a choice option or a text answer equal to the equipment's code or name, or starting
// with it before « · » («Cámara 1 · canales» names «Cámara 1»), so nothing has to be configured. The NC
// sees its work order, and hears when it's done.
import type { TenantDb } from "../../db/tenant.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { FieldsSchema } from "../forms/forms.schemas.ts";
import { readMaintenanceSettings } from "../workspaces/settings.ts";

export async function maintenanceEnabled(db: TenantDb): Promise<boolean> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readMaintenanceSettings(workspace?.settings).enabled;
}

/** The texts a record's answers show: a choice's option label, a text as written. */
function answerTexts(fields: unknown, answers: unknown): string[] {
  const parsed = FieldsSchema.safeParse(fields);
  if (!parsed.success || typeof answers !== "object" || answers === null) return [];
  const values = answers as Record<string, unknown>;
  const texts: string[] = [];
  for (const field of parsed.data) {
    const value = values[field.id];
    if (typeof value !== "string") continue;
    if (field.type === "choice") {
      const option = field.options.find((candidate) => candidate.id === value);
      if (option !== undefined) texts.push(option.label);
    } else if (field.type === "text") {
      texts.push(value);
    }
  }
  return texts;
}

/** The active piece of equipment a record names (by code or name), if exactly one. */
export async function assetNamedByRecord(db: TenantDb, recordId: string): Promise<string | null> {
  const record = await db.formRecord.findFirst({
    where: { id: recordId },
    select: { nodeId: true, version: true, answers: true },
  });
  if (record === null) return null;
  const version = await db.formVersion.findFirst({
    where: { nodeId: record.nodeId, version: record.version },
    select: { fields: true },
  });
  // The whole answer, and what comes before « · » or « - » («Cámara 1 · canales» → «Cámara 1»).
  const keys = new Set(
    answerTexts(version?.fields, record.answers)
      .flatMap((text) => [text, text.split(/\s[·–-]\s/u)[0] ?? ""])
      .map((text) => nameKeyOf(text))
      .filter((key) => key !== ""),
  );
  if (keys.size === 0) return null;
  const assets = await db.maintAsset.findMany({
    where: { archivedAt: null },
    select: { id: true, codeKey: true, name: true },
    take: 2000,
  });
  const matches = assets.filter(
    (asset) => keys.has(asset.codeKey) || keys.has(nameKeyOf(asset.name)),
  );
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

/**
 * Tells the NC its work order moved (done, closed, cancelled, reopened): an entry in its history and a
 * notice to whoever is in charge of it.
 */
export async function noteOnNc(
  db: TenantDb,
  workOrder: { ncId: string | null; code: string; status: string },
  actorId: string,
): Promise<void> {
  if (workOrder.ncId === null) return;
  const nc = await db.qualityNc.findFirst({
    where: { id: workOrder.ncId },
    select: { id: true, ownerId: true },
  });
  if (nc === null) return;
  await db.qualityNcEvent.create({
    data: {
      ncId: nc.id,
      kind: "maintenance",
      actorId,
      data: { code: workOrder.code, status: workOrder.status },
    },
  });
  if (nc.ownerId !== actorId) {
    await db.notification.create({
      data: { membershipId: nc.ownerId, kind: "quality_nc", actorId, detail: nc.id },
      select: { id: true },
    });
  }
}
