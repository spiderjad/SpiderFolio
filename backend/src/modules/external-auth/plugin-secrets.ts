// ctx.secrets of the plugins (docs/spec/plugins.md): encrypted with the core's key (secret-box), with
// the workspace, the plugin and the key as authenticated data, so a value copied to another company,
// plugin or key doesn't decrypt. They never leave the backend.
import type { PluginSecrets } from "@spiderfolio/plugin-sdk/backend";
import { forTenant } from "../../db/tenant.ts";
import { directorySignInTexts } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { SecretBox } from "../../lib/secret-box.ts";

const KEY = /^[a-z][a-zA-Z0-9_.-]{0,63}$/u;

export function createPluginSecrets(
  prisma: PrismaClient,
  box: SecretBox | null,
  workspaceId: string,
  pluginId: string,
): PluginSecrets {
  const db = forTenant(prisma, workspaceId);
  const bound = (key: string) => {
    if (!KEY.test(key)) throw new Error(`Clave de secreto inválida: ${key}`);
    return `${workspaceId}\n${pluginId}\n${key}`;
  };
  const requireBox = (): SecretBox => {
    if (box === null) {
      throw new AppError("UNAVAILABLE", { message: directorySignInTexts.noEncryptionKey });
    }
    return box;
  };
  return {
    async get(key) {
      const aad = bound(key);
      const row = await db.pluginSecret.findFirst({
        where: { pluginId, key },
        select: { valueEnc: true },
      });
      if (row === null) return undefined;
      return requireBox().decrypt(aad, row.valueEnc);
    },
    async set(key, value) {
      const valueEnc = requireBox().encrypt(bound(key), value);
      const existing = await db.pluginSecret.findFirst({
        where: { pluginId, key },
        select: { id: true },
      });
      if (existing === null) await db.pluginSecret.create({ data: { pluginId, key, valueEnc } });
      else await db.pluginSecret.update({ where: { id: existing.id }, data: { valueEnc } });
    },
    async delete(key) {
      bound(key);
      await db.pluginSecret.deleteMany({ where: { pluginId, key } });
    },
    async has(key) {
      bound(key);
      return (await db.pluginSecret.count({ where: { pluginId, key } })) > 0;
    },
  };
}
