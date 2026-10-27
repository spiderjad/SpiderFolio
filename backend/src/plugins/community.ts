// Plugins «community» (de terceros, sin licencia): el propietario los activa en su empresa después de
// confirmar que tienen acceso al servidor. La activación vive en Workspace.settings.communityPlugins,
// fuera del alcance de los plugins (no reciben Prisma ni pueden escribir esos ajustes).
import { z } from "zod";

const CommunityPluginsSchema = z.record(
  z.string(),
  z.object({ enabledAt: z.string(), enabledBy: z.string() }),
);
export type CommunityActivations = z.infer<typeof CommunityPluginsSchema>;

export function readCommunityActivations(settings: unknown): CommunityActivations {
  const raw = (settings as { communityPlugins?: unknown } | null | undefined)?.communityPlugins;
  const parsed = CommunityPluginsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/** Ids de plugins community activados en la empresa. */
export function enabledCommunityPlugins(settings: unknown): ReadonlySet<string> {
  return new Set(Object.keys(readCommunityActivations(settings)));
}
