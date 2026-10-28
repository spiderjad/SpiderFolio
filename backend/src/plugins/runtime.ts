// Plugins en ejecución (docs/spec/plugins.md): qué está instalado, qué está activo en cada workspace
// (comercial: licencia válida que lo incluye; community: activado por el propietario) y los contextos
// que reciben. Un plugin inactivo no responde rutas,
// no corre jobs y sus ganchos no se consultan: el núcleo se comporta como si no existiera.
import type {
  MfaSubject,
  PluginCapability,
  PluginJobContext,
  PluginLogger,
  PluginSettings,
  PluginWorkspaceContext,
  LicenseStatus,
} from "@spiderfolio/plugin-sdk/backend";
import { pluginSchemaName } from "@spiderfolio/plugin-sdk";
import type { KeyObject } from "node:crypto";
import type { Logger } from "pino";
import { pluginQuery } from "../db/raw/plugins.ts";
import { forTenant } from "../db/tenant.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import { enabledCommunityPlugins } from "./community.ts";
import { licensedPlugins, verifyLicense } from "./license.ts";
import type { InstalledPlugin } from "./loader.ts";

/** Cuánto se recuerda la licencia leída de un workspace (la API y el worker son procesos aparte). */
const LICENSE_CACHE_MS = 30_000;

export type SendJob = (queue: string, payload: Record<string, unknown>) => Promise<void>;

export interface PluginRuntime {
  readonly installed: readonly InstalledPlugin[];
  /** Capacidades de todos los plugins instalados (se pueden asignar aunque la licencia venza). */
  readonly capabilities: readonly PluginCapability[];
  licenseStatus(workspaceId: string): Promise<LicenseStatus>;
  /** Verifies a token with this runtime's key, for the company that loads it. */
  verify(token: string, workspaceId: string): LicenseStatus;
  /** Ids activos en el workspace: comerciales en una licencia válida y community activados. */
  activeIds(workspaceId: string): Promise<ReadonlySet<string>>;
  isActive(workspaceId: string, pluginId: string): Promise<boolean>;
  /** Si algún plugin activo agrega la función. */
  hasFeature(workspaceId: string, feature: string): Promise<boolean>;
  contextFor(workspaceId: string, pluginId: string): PluginWorkspaceContext;
  jobContext(pluginId: string): PluginJobContext;
  /** Olvida la licencia y las activaciones community recordadas (al cambiarlas). */
  forget(workspaceId: string): void;
  /** Gancho mfaRequired de los plugins activos: alcanza con que uno la exija. */
  mfaRequired(workspaceId: string, subject: MfaSubject): Promise<boolean>;
  /** Gancho checkMemberEmail: el primer rechazo, o null. */
  checkMemberEmail(workspaceId: string, email: string): Promise<string | null>;
}

export interface RuntimeDeps {
  prisma: PrismaClient;
  logger: Logger;
  installed: readonly InstalledPlugin[];
  /** Encola en pg-boss; sin él (tests, procesos sin colas) encolar falla. */
  send?: SendJob;
  now?: () => Date;
  /** Solo tests: otra clave pública para verificar las licencias. */
  publicKey?: KeyObject;
}

function pluginLogger(logger: Logger, pluginId: string): PluginLogger {
  const child = logger.child({ plugin: pluginId });
  return {
    info: (data, message) => {
      child.info(data, message);
    },
    warn: (data, message) => {
      child.warn(data, message);
    },
    error: (data, message) => {
      child.error(data, message);
    },
  };
}

function settingsStore(
  prisma: PrismaClient,
  workspaceId: string,
  pluginId: string,
): PluginSettings {
  const db = forTenant(prisma, workspaceId);
  return {
    async get(key, schema) {
      const row = await db.pluginSetting.findFirst({
        where: { pluginId, key },
        select: { value: true },
      });
      if (row === null) return undefined;
      const parsed = schema.safeParse(row.value);
      return parsed.success ? parsed.data : undefined;
    },
    async set(key, value) {
      const json = value as Prisma.InputJsonValue;
      const existing = await db.pluginSetting.findFirst({
        where: { pluginId, key },
        select: { id: true },
      });
      if (existing === null) {
        await db.pluginSetting.create({ data: { pluginId, key, value: json } });
      } else {
        await db.pluginSetting.update({ where: { id: existing.id }, data: { value: json } });
      }
    },
    async delete(key) {
      await db.pluginSetting.deleteMany({ where: { pluginId, key } });
    },
  };
}

export function createPluginRuntime(deps: RuntimeDeps): PluginRuntime {
  const { prisma, logger, installed } = deps;
  const now = deps.now ?? (() => new Date());
  const verifyOptions = (workspaceId: string) => ({
    now: now(),
    workspaceId,
    ...(deps.publicKey === undefined ? {} : { publicKey: deps.publicKey }),
  });
  const byId = new Map(installed.map((plugin) => [plugin.manifest.id, plugin]));
  const cache = new Map<
    string,
    { at: number; token: string | null; community: ReadonlySet<string> }
  >();

  /** Licencia y plugins community activados del workspace (recordados LICENSE_CACHE_MS). */
  const stateOf = async (workspaceId: string) => {
    const cached = cache.get(workspaceId);
    const at = now().getTime();
    if (cached !== undefined && at - cached.at < LICENSE_CACHE_MS) return cached;
    const db = forTenant(prisma, workspaceId);
    const [license, workspace] = await Promise.all([
      db.workspaceLicense.findFirst({ select: { token: true } }),
      db.workspace.findFirst({ where: {}, select: { settings: true } }),
    ]);
    const state = {
      at,
      token: license?.token ?? null,
      community: enabledCommunityPlugins(workspace?.settings),
    };
    cache.set(workspaceId, state);
    return state;
  };

  const licenseStatus = async (workspaceId: string) =>
    verifyLicense((await stateOf(workspaceId)).token, verifyOptions(workspaceId));

  /** Comercial: en una licencia válida. Community: activado por el propietario de la empresa. */
  const isOn = (plugin: InstalledPlugin, licensed: ReadonlySet<string>, community: ReadonlySet<string>) =>
    plugin.manifest.distribution === "community"
      ? community.has(plugin.manifest.id)
      : licensed.has(plugin.manifest.id);

  const activeIds = async (workspaceId: string): Promise<ReadonlySet<string>> => {
    if (installed.length === 0) return new Set();
    const state = await stateOf(workspaceId);
    const licensed = licensedPlugins(verifyLicense(state.token, verifyOptions(workspaceId)));
    return new Set(
      installed.filter((p) => isOn(p, licensed, state.community)).map((p) => p.manifest.id),
    );
  };

  const contextFor = (workspaceId: string, pluginId: string): PluginWorkspaceContext => {
    const schema = pluginSchemaName(pluginId);
    const jobs = new Set((byId.get(pluginId)?.backend?.jobs ?? []).map((job) => job.name));
    return {
      pluginId,
      workspaceId,
      settings: settingsStore(prisma, workspaceId, pluginId),
      sql: {
        query: (text, values = []) => pluginQuery(prisma, schema, text, values),
      },
      logger: pluginLogger(logger, pluginId),
      async enqueue(job, payload) {
        if (!jobs.has(job)) throw new Error(`El plugin ${pluginId} no declara el job ${job}`);
        if (deps.send === undefined) throw new Error("Este proceso no puede encolar jobs");
        await deps.send(`plugin.${pluginId}.${job}`, { ...payload, workspaceId });
      },
    };
  };

  /** Plugins activos en el workspace que implementan el gancho. */
  const withHook = async (workspaceId: string, hook: "mfaRequired" | "checkMemberEmail") => {
    const active = await activeIds(workspaceId);
    return installed.filter(
      (plugin) => active.has(plugin.manifest.id) && plugin.backend?.hooks?.[hook] !== undefined,
    );
  };

  return {
    installed,
    capabilities: installed.flatMap((plugin) => plugin.backend?.capabilities ?? []),
    licenseStatus,
    verify: (token, workspaceId) => verifyLicense(token, verifyOptions(workspaceId)),
    activeIds,
    async isActive(workspaceId, pluginId) {
      return (await activeIds(workspaceId)).has(pluginId);
    },
    async hasFeature(workspaceId, feature) {
      const active = await activeIds(workspaceId);
      return installed.some(
        (plugin) =>
          active.has(plugin.manifest.id) && (plugin.backend?.features ?? []).includes(feature),
      );
    },
    contextFor,
    jobContext(pluginId) {
      return {
        logger: pluginLogger(logger, pluginId),
        async forWorkspace(workspaceId) {
          return (await activeIds(workspaceId)).has(pluginId)
            ? contextFor(workspaceId, pluginId)
            : null;
        },
        async activeWorkspaces() {
          if (byId.get(pluginId)?.manifest.distribution === "community") {
            const workspaces = await prisma.workspace.findMany({
              where: { deletedAt: null },
              select: { id: true, settings: true },
            });
            return workspaces
              .filter((workspace) => enabledCommunityPlugins(workspace.settings).has(pluginId))
              .map((workspace) => workspace.id);
          }
          const rows = await prisma.workspaceLicense.findMany({
            where: { workspace: { deletedAt: null } },
            select: { workspaceId: true, token: true },
          });
          return rows
            .filter((row) =>
              licensedPlugins(verifyLicense(row.token, verifyOptions(row.workspaceId))).has(pluginId),
            )
            .map((row) => row.workspaceId);
        },
      };
    },
    forget(workspaceId) {
      cache.delete(workspaceId);
    },
    async mfaRequired(workspaceId, subject) {
      for (const plugin of await withHook(workspaceId, "mfaRequired")) {
        const ctx = contextFor(workspaceId, plugin.manifest.id);
        if (await plugin.backend?.hooks?.mfaRequired?.(ctx, subject)) return true;
      }
      return false;
    },
    async checkMemberEmail(workspaceId, email) {
      for (const plugin of await withHook(workspaceId, "checkMemberEmail")) {
        const ctx = contextFor(workspaceId, plugin.manifest.id);
        const problem = await plugin.backend?.hooks?.checkMemberEmail?.(ctx, email);
        if (problem !== null && problem !== undefined) return problem;
      }
      return null;
    },
  };
}

/** Runtime sin plugins (tests y procesos que no los cargan). */
export function emptyPluginRuntime(prisma: PrismaClient, logger: Logger): PluginRuntime {
  return createPluginRuntime({ prisma, logger, installed: [] });
}
