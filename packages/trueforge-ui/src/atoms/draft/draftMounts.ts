/** Catalog-backed mount shape used by the draft picker (runtime mounts stay opaque). */
export type DraftMount = { id: string; name: string; preload?: boolean };

/**
 * Harness wire mounts are name-keyed (`{ name }` only). Catalog rows use
 * `id === name`, so missing ids hydrate from name — otherwise save/load drops
 * mounts from the picker and the next flush can wipe them from the spec.
 */
export function draftMountsFromSpec(value: unknown): DraftMount[] {
  if (!Array.isArray(value)) return [];
  const mounts: DraftMount[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const name = Reflect.get(item, 'name');
    if (typeof name !== 'string') continue;
    const id = Reflect.get(item, 'id');
    const displayName = Reflect.get(item, 'display_name');
    const preload = Reflect.get(item, 'preload');
    mounts.push({
      id: typeof id === 'string' ? id : name,
      name: typeof displayName === 'string' ? displayName : name,
      ...(typeof preload === 'boolean' ? { preload } : {}),
    });
  }
  return mounts;
}
