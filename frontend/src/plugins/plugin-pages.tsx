// Pantallas de plugins: /app/:slug/p/:pluginId/* y la sección de Administración
// /app/:slug/admin/p/:pluginId/:section/*. Si el plugin no está activo, no existe (misma pantalla que
// una ruta inexistente).
import type { ComponentType } from "react";
import { lazy, Suspense } from "react";
import { useParams } from "react-router";
import type { PluginScreenProps } from "@spiderfolio/plugin-sdk/frontend";
import { Skeleton } from "@/components/ui/display";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import { allowed, usePluginsState } from "./registry";

type Loader = () => Promise<{ default: ComponentType<PluginScreenProps> }>;

// Un lazy() por cargador: si se creara en cada render, React montaría la pantalla de nuevo.
const lazyCache = new WeakMap<Loader, ComponentType<PluginScreenProps>>();

function lazyOf(load: Loader): ComponentType<PluginScreenProps> {
  let component = lazyCache.get(load);
  if (component === undefined) {
    component = lazy(load);
    lazyCache.set(load, component);
  }
  return component;
}

function Screen({ load, slug, subpath }: { load: Loader } & PluginScreenProps) {
  const Component = lazyOf(load);
  return (
    <Suspense fallback={<Skeleton className="h-48 w-full" />}>
      <Component slug={slug} subpath={subpath} />
    </Suspense>
  );
}

export function PluginScreenPage() {
  const membership = useMembership();
  const slug = membership.workspace.slug;
  const { pluginId, "*": rest = "" } = useParams();
  const { plugins, ready } = usePluginsState(slug);
  if (!ready) return <Skeleton className="h-48 w-full" />;
  const plugin = plugins.find((p) => p.id === pluginId);
  const [first = "", ...others] = rest.split("/");
  const screen =
    plugin?.screens?.find((s) => s.path === first) ?? plugin?.screens?.find((s) => s.path === "");
  if (plugin === undefined || screen === undefined) return <NotFoundPage />;
  const subpath = screen.path === first ? others.join("/") : rest;
  return <Screen load={screen.component} slug={slug} subpath={subpath} />;
}

export function PluginAdminPage() {
  const membership = useMembership();
  const slug = membership.workspace.slug;
  const { pluginId, section: sectionId, "*": rest = "" } = useParams();
  const { plugins, ready } = usePluginsState(slug);
  if (!ready) return <Skeleton className="h-48 w-full" />;
  const plugin = plugins.find((p) => p.id === pluginId);
  const section = plugin?.adminSections?.find((s) => s.id === sectionId);
  if (
    section === undefined ||
    !allowed(membership, section.anyCapability) ||
    (section.ownerOnly === true && membership.role.base !== "OWNER")
  ) {
    return <NotFoundPage />;
  }
  return <Screen load={section.component} slug={slug} subpath={rest} />;
}
