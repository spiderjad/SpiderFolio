// Puntos de extensión de la app (docs/spec/plugins.md). El plugin exporta por defecto un
// FrontendPlugin; la app lo incluye al compilar (Vite) y solo muestra lo suyo en los workspaces donde
// el servidor dice que está activo. Ocultar no es proteger: cada ruta del plugin se valida en el
// backend.
import type { ComponentType } from "react";
import type { PluginId } from "./index.ts";

export * from "./index.ts";

/** Compatible con los íconos de lucide-react. */
export type Icon = ComponentType<{
  className?: string | undefined;
  strokeWidth?: string | number | undefined;
  "aria-hidden"?: boolean | "true" | "false" | undefined;
}>;

/** Quién usa la app en este workspace (lo mismo que decide el menú del núcleo). */
export interface PluginPerson {
  role: { base: "OWNER" | "ADMIN" | "MEMBER" | "GUEST" };
  capabilities: readonly string[];
}

type LazyComponent<P = object> = () => Promise<{ default: ComponentType<P> }>;

/** Props de toda pantalla de plugin. */
export interface PluginScreenProps {
  slug: string;
  /** Lo que sigue a /app/:slug/p/<id>/ (o a la sección de administración). */
  subpath: string;
}

/** Pantalla en /app/:slug/p/<id>/<path>. */
export interface PluginScreen {
  /** Primer segmento de la ruta ("" = la pantalla principal del plugin). */
  path: string;
  title: string;
  component: LazyComponent<PluginScreenProps>;
}

/** Ítem del menú lateral; `to` es una pantalla del plugin. */
export interface PluginNavItem {
  to: string;
  label: string;
  icon: Icon;
  /** Alcanza con una; sin esto lo ve todo miembro. */
  anyCapability?: readonly string[];
}

/** Sección del panel de Administración en /app/:slug/admin/p/<id>/<section>. */
export interface PluginAdminSection {
  id: string;
  label: string;
  icon: Icon;
  /** Alcanza con una. */
  anyCapability: readonly string[];
  ownerOnly?: boolean;
  component: LazyComponent<PluginScreenProps>;
}

export type PluginNodeType = "FOLDER" | "FILE" | "PAGE" | "LINK";

/** El elemento sobre el que se abre la acción (fila del explorador o documento abierto). */
export interface PluginNodeContext {
  slug: string;
  person: PluginPerson;
  node: {
    id: string;
    spaceId: string;
    type: PluginNodeType;
    name: string;
    mimeType: string | null;
    /** Nivel de acceso de la persona sobre el elemento. */
    level: string;
  };
}

/** Acción en el menú de un elemento. Con `dialog`, la app lo abre y lo cierra con onClose. */
export interface PluginNodeAction {
  id: string;
  label: string;
  icon: Icon;
  visible?(ctx: PluginNodeContext): boolean;
  onSelect?(ctx: PluginNodeContext): void;
  dialog?: LazyComponent<{ ctx: PluginNodeContext; onClose: () => void }>;
}

/** Acción del botón «Nuevo» del explorador, en la carpeta abierta. */
export interface PluginFolderContext {
  slug: string;
  person: PluginPerson;
  spaceId: string;
  folderId: string | null;
}

export interface PluginFolderAction {
  id: string;
  label: string;
  icon: Icon;
  visible?(ctx: PluginFolderContext): boolean;
  dialog: LazyComponent<{ ctx: PluginFolderContext; onClose: () => void }>;
}

export interface FrontendPlugin {
  id: PluginId;
  navItems?: readonly PluginNavItem[];
  screens?: readonly PluginScreen[];
  adminSections?: readonly PluginAdminSection[];
  /** Menú de un documento abierto (página). */
  documentActions?: readonly PluginNodeAction[];
  /** Menú de cada fila del explorador. */
  explorerActions?: readonly PluginNodeAction[];
  /** Botón «Nuevo» del explorador. */
  folderActions?: readonly PluginFolderAction[];
  /** Textos de la app del plugin (en español). */
  i18n?: Readonly<Record<string, string>>;
}

export function defineFrontendPlugin<const T extends FrontendPlugin>(plugin: T): T {
  return plugin;
}
