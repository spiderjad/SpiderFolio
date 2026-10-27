// Menú lateral contraído o expandido: el navegador recuerda la preferencia entre sesiones (no es
// un dato sensible; junto con theme.ts y kiosk.ts, una excepción a la regla de no usar localStorage).
const KEY = "spiderfolio-sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // Sin almacenamiento (modo privado): la preferencia vale solo en esta sesión.
  }
}

// Secciones plegables del menú (Favoritos y Recientes): abiertas por defecto, recuerdan su estado.
export type SidebarSection = "favorites" | "recents";
const sectionKey = (section: SidebarSection) => `spiderfolio-sidebar-${section}`;

export function readSidebarSection(section: SidebarSection): boolean {
  try {
    return window.localStorage.getItem(sectionKey(section)) !== "closed";
  } catch {
    return true;
  }
}

export function saveSidebarSection(section: SidebarSection, open: boolean): void {
  try {
    window.localStorage.setItem(sectionKey(section), open ? "open" : "closed");
  } catch {
    // Sin almacenamiento (modo privado): el estado vale solo en esta sesión.
  }
}
