// Fuentes de los combobox del panel (CLAUDE.md, sección 17): cada una busca en el servidor, de a
// páginas, y sabe traer las etiquetas de ids ya elegidos. Ningún selector carga la lista completa.
import { useMemo } from "react";
import { COMBO_PAGE_SIZE, type ComboboxSource, type ComboOption } from "@/components/ui/combobox";
import {
  adminApi,
  adminKeys,
  type DepartmentOptionView,
  type MemberView,
  type RoleView,
} from "./api";

const roleOption = (role: RoleView): ComboOption => ({
  id: role.id,
  label: role.name,
  ...(role.description === null ? {} : { description: role.description }),
  meta: { base: role.base, system: String(role.isSystem) },
});

/**
 * Sin búsqueda, los departamentos van en orden de árbol (con su nivel, para indentar); al buscar,
 * con la ruta completa ("Finanzas › Contabilidad").
 */
const departmentOption =
  (searching: boolean) =>
  (department: DepartmentOptionView): ComboOption => ({
    id: department.id,
    label: department.name,
    ...(department.description === null ? {} : { description: department.description }),
    ...(searching ? { path: department.path } : { depth: department.depth }),
  });

export function memberOption(member: Pick<MemberView, "id" | "name" | "email">): ComboOption {
  return {
    id: member.id,
    label: member.name,
    ...(member.email === null ? {} : { description: member.email }),
  };
}

/** Roles. `accept` deja afuera los que quien mira no puede asignar. */
export function useRoleSource(
  slug: string,
  options: { accept?: (role: RoleView) => boolean; pinned?: ComboOption[] } = {},
): ComboboxSource {
  const { accept, pinned } = options;
  return useMemo(
    () => ({
      key: [...adminKeys.roles(slug), "combobox"],
      search: async (q, cursor, signal) => {
        const result = await adminApi.roleOptions(
          slug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        const roles = accept === undefined ? result.items : result.items.filter(accept);
        return { items: roles.map(roleOption), nextCursor: result.nextCursor };
      },
      byIds: async (ids) => (await adminApi.roleOptions(slug, { ids })).items.map(roleOption),
      ...(pinned === undefined ? {} : { pinned }),
    }),
    [slug, accept, pinned],
  );
}

/** Departamentos. `exclude` saca ids de los resultados (ej. el propio departamento). */
export function useDepartmentSource(
  slug: string,
  options: { exclude?: readonly string[]; pinned?: ComboOption[] } = {},
): ComboboxSource {
  const excluded = options.exclude?.join(",") ?? "";
  const { pinned } = options;
  return useMemo(
    () => ({
      key: [...adminKeys.departments(slug), "combobox"],
      search: async (q, cursor, signal) => {
        const result = await adminApi.departmentOptions(
          slug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        const skip = new Set(excluded.split(",").filter((id) => id !== ""));
        return {
          items: result.items.filter((d) => !skip.has(d.id)).map(departmentOption(q.trim() !== "")),
          nextCursor: result.nextCursor,
        };
      },
      byIds: async (ids) =>
        (await adminApi.departmentOptions(slug, { ids })).items.map(departmentOption(false)),
      ...(pinned === undefined ? {} : { pinned }),
    }),
    [slug, excluded, pinned],
  );
}

/**
 * Personas del directorio (para sumar a un departamento). Las que ya están en `inDepartment` salen
 * marcadas y no se pueden elegir.
 */
export function useDirectorySource(
  slug: string,
  options: { inDepartment?: string } = {},
): ComboboxSource {
  const { inDepartment } = options;
  return useMemo(
    () => ({
      key: [...adminKeys.members(slug), "directory", inDepartment ?? ""],
      search: async (q, cursor, signal) => {
        const result = await adminApi.directory(
          slug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: result.items.map((person) => ({
            id: person.id,
            label: person.name,
            description: person.jobTitle ?? person.departments.map((d) => d.name).join(", "),
            disabled: person.departments.some((d) => d.id === inDepartment),
          })),
          nextCursor: result.nextCursor,
        };
      },
      // El directorio no resuelve ids: las etiquetas elegidas las guarda el selector.
      byIds: () => Promise.resolve([]),
    }),
    [slug, inDepartment],
  );
}

/** Personas (por nombre, email o puesto), por defecto solo activas. */
export function useMemberSource(
  slug: string,
  options: { status?: "ACTIVE" | "SUSPENDED" | "" } = {},
): ComboboxSource {
  const status = options.status ?? "ACTIVE";
  return useMemo(
    () => ({
      key: [...adminKeys.members(slug), "combobox", status],
      search: async (q, cursor, signal) => {
        const result = await adminApi.members(
          slug,
          {
            q,
            role: "",
            department: "",
            group: "",
            status,
            cursor,
            pageSize: COMBO_PAGE_SIZE,
            sort: "name",
            dir: "asc",
          },
          signal,
        );
        return { items: result.items.map(memberOption), nextCursor: result.nextCursor };
      },
      byIds: async (ids) =>
        (
          await adminApi.members(slug, {
            q: "",
            ids,
            role: "",
            department: "",
            group: "",
            status: "",
            page: 1,
            pageSize: 50,
            sort: "name",
            dir: "asc",
          })
        ).items.map(memberOption),
    }),
    [slug, status],
  );
}
