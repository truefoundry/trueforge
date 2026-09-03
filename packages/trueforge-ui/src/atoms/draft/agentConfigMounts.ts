export type EditableMount = {
  id: string;
  name: string;
  value: object;
};

export function editableMountsFromSpec(value: unknown): EditableMount[] {
  if (!Array.isArray(value)) return [];
  const mounts: EditableMount[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const name = Reflect.get(item, 'name');
    const fqn = Reflect.get(item, 'fqn');
    const displayName = typeof name === 'string' ? name : typeof fqn === 'string' ? fqn : null;
    if (displayName === null) continue;
    const id = Reflect.get(item, 'id');
    mounts.push({ id: typeof id === 'string' ? id : displayName, name: displayName, value: item });
  }
  return mounts;
}

export function enabledToolsFromMount(value: object): string[] | 'all' {
  const enabled = Reflect.get(value, 'enableTools');
  if (!Array.isArray(enabled) || enabled.includes('@all')) return 'all';
  return enabled.filter((tool): tool is string => typeof tool === 'string' && !tool.startsWith('@'));
}

export function withEnabledTools(value: object, enabledTools: string[] | 'all'): object {
  return {
    ...value,
    enableTools: enabledTools === 'all' ? ['@all'] : enabledTools,
  };
}

export function withPreload(value: object, preload: boolean): object {
  return { ...value, preload };
}
