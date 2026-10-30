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

/** A style rule's place in the cascade: its @layer/@media/@supports wrappers and its selector. */
function ruleKeys(rules: CSSRuleList, context: string, keys: Set<string>): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      keys.add(`${context}|${rule.selectorText}`);
    } else if (rule instanceof CSSGroupingRule) {
      ruleKeys(rule.cssRules, `${context}>${groupName(rule)}`, keys);
    }
  }
}

/**
 * One spelling per media condition: the app's stylesheet says `(width >= 40rem)` and a plugin's,
 * minified by another tool, `(min-width: 40rem)`; both are the same breakpoint.
 */
function sameMedia(text: string): string {
  return text
    .replace(/\(\s*width\s*>=\s*([^)]+?)\s*\)/gu, "(min-width: $1)")
    .replace(/\(\s*width\s*<=\s*([^)]+?)\s*\)/gu, "(max-width: $1)")
    .replace(/\s+/gu, " ")
    .trim();
}

function groupName(rule: CSSGroupingRule): string {
  if (rule instanceof CSSLayerBlockRule) return `@layer ${rule.name}`;
  if (rule instanceof CSSMediaRule) return `@media ${sameMedia(rule.media.mediaText)}`;
  if (rule instanceof CSSSupportsRule) return `@supports ${rule.conditionText}`;
  return "@group";
}

/** Deletes from `container` every style rule the app's stylesheet already has, in the same place. */
function dropShared(
  container: CSSStyleSheet | CSSGroupingRule,
  context: string,
  app: Set<string>,
): void {
  for (let index = container.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = container.cssRules[index];
    if (rule instanceof CSSStyleRule && app.has(`${context}|${rule.selectorText}`)) {
      container.deleteRule(index);
    } else if (rule instanceof CSSGroupingRule) {
      dropShared(rule, `${context}>${groupName(rule)}`, app);
    }
  }
}

const added = new Set<string>();

/**
 * A plugin's stylesheet, after the app's. It carries the Tailwind utilities the plugin uses in the
 * same «utilities» layer, so a plain `.inline-flex` of the plugin, coming later, would beat the app's
 * own `lg:hidden` and break the app's screens. The rules the app already has are dropped from it: the
 * app's screens keep their order and the plugin's own classes still apply.
 */
async function addStyles(href: string): Promise<void> {
  if (added.has(href)) return;
  added.add(href);
  const response = await fetch(href, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Estilos del plugin: HTTP ${String(response.status)}`);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(await response.text());
  const app = new Set<string>();
  for (const own of Array.from(document.styleSheets)) {
    try {
      ruleKeys(own.cssRules, "", app);
    } catch {
      // A stylesheet that can't be read (another origin) has nothing of the app's.
    }
  }
  dropShared(sheet, "", app);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
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
          if (bundle.styles !== null) await addStyles(sameOrigin(bundle.styles));
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
