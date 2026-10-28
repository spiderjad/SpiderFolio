// App plugins (docs/spec/plugins.md): those compiled into the app and those the server ships already
// built (frontendBundle, loaded at runtime from the same origin), shown only if the server says they
// are active in the workspace (valid license). Hiding is not protecting: the backend answers 404 to the
// routes of an inactive plugin.
import { useQuery } from "@tanstack/react-query";
import type { FrontendPlugin, PluginPerson } from "@spiderfolio/plugin-sdk/frontend";
import installed from "virtual:spiderfolio-plugins";
import { useMemo } from "react";
import { api } from "@/lib/api";

/** Plugins compiled into the app (from their source). */
export const installedPlugins: readonly FrontendPlugin[] = installed;

export interface ActivePlugin {
  id: string;
  name: string;
  version: string;
  /** Built app to load at runtime; null if it is compiled in or the plugin has no app part. */
  bundle: { script: string; styles: string | null } | null;
}

export const pluginKeys = {
  active: (slug: string) => ["plugins", slug, "active"] as const,
  bundles: (slug: string, plugins: readonly ActivePlugin[]) =>
    [
      "plugins",
      slug,
      "bundles",
      plugins.map((plugin) => `${plugin.id}@${plugin.version}`),
    ] as const,
  license: (slug: string) => ["plugins", slug, "license"] as const,
};

export const pluginsApi = {
  active: (slug: string) => api<{ plugins: ActivePlugin[] }>(`/w/${slug}/plugins`),
};

/** Only paths of this origin: the server builds them, but a bundle never comes from elsewhere. */
function sameOrigin(path: string): string {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/plugin-assets/")) {
    throw new Error(`Bundle fuera de /plugin-assets: ${path}`);
  }
  return url.href;
}

function addStyles(href: string): void {
  if (document.querySelector(`link[data-plugin-styles="${CSS.escape(href)}"]`) !== null) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.pluginStyles = href;
  document.head.append(link);
}

/** Loads the built plugins that aren't compiled in. One that fails stays out (logged); never throws. */
async function loadBundles(plugins: readonly ActivePlugin[]): Promise<FrontendPlugin[]> {
  const compiled = new Set(installedPlugins.map((plugin) => plugin.id));
  const loaded = await Promise.all(
    plugins
      .filter((plugin) => plugin.bundle !== null && !compiled.has(plugin.id))
      .map(async (plugin): Promise<FrontendPlugin | null> => {
        const { bundle } = plugin;
        if (bundle === null) return null;
        try {
          if (bundle.styles !== null) addStyles(sameOrigin(bundle.styles));
          const module = (await import(/* @vite-ignore */ sameOrigin(bundle.script))) as {
            default?: FrontendPlugin;
          };
          if (module.default?.id !== plugin.id) {
            throw new Error("El bundle no exporta por defecto un plugin con su id");
          }
          return module.default;
        } catch (error) {
          console.error(`Plugin ${plugin.id} no cargado`, error);
          return null;
        }
      }),
  );
  return loaded.filter((plugin) => plugin !== null);
}

/** The app parts of the plugins active in the workspace; ready = it's already known which ones. */
export function usePluginsState(slug: string): {
  plugins: readonly FrontendPlugin[];
  ready: boolean;
} {
  const active = useQuery({
    queryKey: pluginKeys.active(slug),
    queryFn: () => pluginsApi.active(slug),
    staleTime: 5 * 60_000,
    enabled: slug !== "",
  });
  const list = active.data?.plugins;
  const runtime = list?.filter((plugin) => plugin.bundle !== null) ?? [];
  const bundles = useQuery({
    queryKey: pluginKeys.bundles(slug, runtime),
    queryFn: () => loadBundles(runtime),
    // A loaded module stays in the browser: no need to load it again during the session.
    staleTime: Infinity,
    enabled: runtime.length > 0,
  });
  const loaded = bundles.data;
  const plugins = useMemo(() => {
    if (list === undefined) return [];
    const ids = new Set(list.map((plugin) => plugin.id));
    return [...installedPlugins.filter((plugin) => ids.has(plugin.id)), ...(loaded ?? [])];
  }, [list, loaded]);
  const ready = slug === "" || (!active.isPending && (runtime.length === 0 || !bundles.isPending));
  return { plugins, ready };
}

export function useActivePlugins(slug: string): readonly FrontendPlugin[] {
  return usePluginsState(slug).plugins;
}

/** One of the capabilities is enough (no list: everyone). */
export function allowed(person: PluginPerson, anyCapability?: readonly string[]): boolean {
  if (anyCapability === undefined || anyCapability.length === 0) return true;
  return anyCapability.some((capability) => person.capabilities.includes(capability));
}

export const pluginPath = (slug: string, pluginId: string, to: string) =>
  `/app/${slug}/p/${pluginId}${to === "" || to === "/" ? "" : `/${to.replace(/^\//u, "")}`}`;

export const pluginAdminPath = (slug: string, pluginId: string, section: string) =>
  `/app/${slug}/admin/p/${pluginId}/${section}`;
