// Plugins de la app (docs/spec/plugins.md): los incluidos al compilar y, de esos, los activos en el
// workspace según el servidor (licencia vigente). Ocultar no es proteger: el backend responde 404 a las
// rutas de un plugin inactivo.
import { useQuery } from "@tanstack/react-query";
import type { FrontendPlugin, PluginPerson } from "@spiderfolio/plugin-sdk/frontend";
import installed from "virtual:spiderfolio-plugins";
import { useMemo } from "react";
import { api } from "@/lib/api";

export const installedPlugins: readonly FrontendPlugin[] = installed;

export interface ActivePlugin {
  id: string;
  name: string;
  version: string;
}

export const pluginKeys = {
  active: (slug: string) => ["plugins", slug, "active"] as const,
  license: (slug: string) => ["plugins", slug, "license"] as const,
};

export const pluginsApi = {
  active: (slug: string) => api<{ plugins: ActivePlugin[] }>(`/w/${slug}/plugins`),
};

/** Las partes de app de los plugins activos en el workspace; ready = ya se sabe cuáles son. */
export function usePluginsState(slug: string): {
  plugins: readonly FrontendPlugin[];
  ready: boolean;
} {
  const query = useQuery({
    queryKey: pluginKeys.active(slug),
    queryFn: () => pluginsApi.active(slug),
    staleTime: 5 * 60_000,
    enabled: installedPlugins.length > 0 && slug !== "",
  });
  const ids = query.data?.plugins;
  const plugins = useMemo(() => {
    if (ids === undefined) return [];
    const active = new Set(ids.map((plugin) => plugin.id));
    return installedPlugins.filter((plugin) => active.has(plugin.id));
  }, [ids]);
  return { plugins, ready: installedPlugins.length === 0 || !query.isPending };
}

export function useActivePlugins(slug: string): readonly FrontendPlugin[] {
  return usePluginsState(slug).plugins;
}

/** Alcanza con una de las capacidades (sin lista: todos). */
export function allowed(person: PluginPerson, anyCapability?: readonly string[]): boolean {
  if (anyCapability === undefined || anyCapability.length === 0) return true;
  return anyCapability.some((capability) => person.capabilities.includes(capability));
}

export const pluginPath = (slug: string, pluginId: string, to: string) =>
  `/app/${slug}/p/${pluginId}${to === "" || to === "/" ? "" : `/${to.replace(/^\//u, "")}`}`;

export const pluginAdminPath = (slug: string, pluginId: string, section: string) =>
  `/app/${slug}/admin/p/${pluginId}/${section}`;
