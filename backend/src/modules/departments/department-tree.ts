// Jerarquía de departamentos (CLAUDE.md, sección 6 y 9.3): funciones puras sobre el mapa
// id → parentId de un workspace.

export type ParentMap = ReadonlyMap<string, string | null>;

export function parentMapOf(departments: readonly { id: string; parentId: string | null }[]) {
  return new Map(departments.map((d) => [d.id, d.parentId]));
}

/** Los ids dados más todos sus ancestros, sin repetir. Un id desconocido se conserva. */
export function withAncestors(ids: readonly string[], parents: ParentMap): string[] {
  const result = new Set<string>();
  for (const id of ids) {
    let current: string | null | undefined = id;
    // El tope evita un bucle infinito si la base tuviera un ciclo (no debería).
    for (let hops = 0; current !== null && current !== undefined && hops <= parents.size; hops++) {
      if (result.has(current)) break;
      result.add(current);
      current = parents.get(current);
    }
  }
  return [...result];
}

/** Los ids dados más todos sus descendientes, sin repetir. */
export function withDescendants(ids: readonly string[], parents: ParentMap): string[] {
  const children = new Map<string, string[]>();
  for (const [id, parentId] of parents) {
    if (parentId === null) continue;
    children.set(parentId, [...(children.get(parentId) ?? []), id]);
  }
  const result = new Set<string>();
  const pending = [...ids];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || result.has(id)) continue;
    result.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return [...result];
}

/** True si poner `parentId` como padre de `id` formaría un ciclo (o es el mismo departamento). */
export function wouldCreateCycle(id: string, parentId: string | null, parents: ParentMap): boolean {
  if (parentId === null) return false;
  return withAncestors([parentId], parents).includes(id);
}
