// Acciones de plugins en los menús del núcleo (explorador, documento abierto y «Nuevo»). Una acción con
// diálogo lo abre en PluginDialogHost, fuera del menú (el menú se cierra al elegir).
import type { ComponentType } from "react";
import { lazy, Suspense, useSyncExternalStore } from "react";
import type {
  PluginFolderAction,
  PluginFolderContext,
  PluginNodeAction,
  PluginNodeContext,
} from "@spiderfolio/plugin-sdk/frontend";
import { DropdownMenuItem } from "@/components/ui/overlay";
import { useActivePlugins } from "./registry";

type DialogLoader<P> = () => Promise<{ default: ComponentType<P> }>;

interface OpenDialog {
  key: string;
  render: () => React.ReactNode;
}

let open: OpenDialog | null = null;
const listeners = new Set<() => void>();

function setOpen(next: OpenDialog | null) {
  open = next;
  for (const listener of listeners) listener();
}

const close = () => {
  setOpen(null);
};

const lazyCache = new WeakMap<object, ComponentType<never>>();

function lazyOf<P>(load: DialogLoader<P>): ComponentType<P> {
  const cached = lazyCache.get(load) as ComponentType<P> | undefined;
  if (cached !== undefined) return cached;
  const component = lazy(load) as unknown as ComponentType<P>;
  lazyCache.set(load, component as ComponentType<never>);
  return component;
}

function openDialog<C>(
  key: string,
  load: DialogLoader<{ ctx: C; onClose: () => void }>,
  ctx: C,
): void {
  const Component = lazyOf(load);
  setOpen({
    key,
    render: () => (
      <Suspense fallback={null}>
        <Component ctx={ctx} onClose={close} />
      </Suspense>
    ),
  });
}

/** Va una vez en el layout del workspace. */
export function PluginDialogHost() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
  return current === null ? null : <div key={current.key}>{current.render()}</div>;
}

function NodeItems({
  actions,
  ctx,
}: {
  actions: readonly { pluginId: string; action: PluginNodeAction }[];
  ctx: PluginNodeContext;
}) {
  return actions
    .filter(({ action }) => action.visible?.(ctx) ?? true)
    .map(({ pluginId, action }) => {
      const Icon = action.icon;
      return (
        <DropdownMenuItem
          key={`${pluginId}:${action.id}`}
          onSelect={() => {
            action.onSelect?.(ctx);
            if (action.dialog !== undefined) {
              openDialog(`${pluginId}:${action.id}`, action.dialog, ctx);
            }
          }}
        >
          <Icon aria-hidden="true" />
          {action.label}
        </DropdownMenuItem>
      );
    });
}

/** Ítems de plugins para el menú de un elemento (fila del explorador o documento abierto). */
export function PluginNodeMenuItems({
  kind,
  ctx,
}: {
  kind: "explorerActions" | "documentActions";
  ctx: PluginNodeContext;
}) {
  const plugins = useActivePlugins(ctx.slug);
  const actions = plugins.flatMap((plugin) =>
    (plugin[kind] ?? []).map((action) => ({ pluginId: plugin.id, action })),
  );
  if (actions.length === 0) return null;
  return <NodeItems actions={actions} ctx={ctx} />;
}

/** Ítems de plugins para el botón «Nuevo» del explorador. */
export function PluginFolderMenuItems({ ctx }: { ctx: PluginFolderContext }) {
  const plugins = useActivePlugins(ctx.slug);
  const actions: { pluginId: string; action: PluginFolderAction }[] = plugins.flatMap((plugin) =>
    (plugin.folderActions ?? []).map((action) => ({ pluginId: plugin.id, action })),
  );
  return actions
    .filter(({ action }) => action.visible?.(ctx) ?? true)
    .map(({ pluginId, action }) => {
      const Icon = action.icon;
      return (
        <DropdownMenuItem
          key={`${pluginId}:${action.id}`}
          onSelect={() => {
            openDialog(`${pluginId}:${action.id}`, action.dialog, ctx);
          }}
        >
          <Icon aria-hidden="true" />
          {action.label}
        </DropdownMenuItem>
      );
    });
}
