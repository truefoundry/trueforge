import { DEFAULT_APPROVAL_SELECTORS, sameSelectors } from './mcpToolApprovals.js';
import { TOOL_TAG_ALL } from './mcpToolSelectors.js';

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
    const displayNameRaw = Reflect.get(item, 'display_name');
    const name = Reflect.get(item, 'name');
    const displayName = typeof displayNameRaw === 'string' ? displayNameRaw : typeof name === 'string' ? name : null;
    if (displayName === null) continue;
    const id = Reflect.get(item, 'id');
    mounts.push({ id: typeof id === 'string' ? id : displayName, name: displayName, value: item });
  }
  return mounts;
}

export function enabledToolsFromMount(value: object): string[] | 'all' {
  const enabled = Reflect.get(value, 'enableTools');
  if (!Array.isArray(enabled) || enabled.includes(TOOL_TAG_ALL)) return 'all';
  return enabled.filter((tool): tool is string => typeof tool === 'string' && !tool.startsWith('@'));
}

function selectorsFromMount({ value, key }: { value: object; key: string }): string[] | undefined {
  const selectors = Reflect.get(value, key);
  if (!Array.isArray(selectors)) return undefined;
  return selectors.filter((selector): selector is string => typeof selector === 'string');
}

/** Omitting `enableTools` enables every tool, matching the harness default. */
export function enableSelectorsFromMount(value: object): string[] {
  return selectorsFromMount({ value, key: 'enableTools' }) ?? [TOOL_TAG_ALL];
}

export function disableSelectorsFromMount(value: object): string[] {
  return selectorsFromMount({ value, key: 'disableTools' }) ?? [];
}

export function withEnabledTools(value: object, enabledTools: string[] | 'all'): object {
  return {
    ...value,
    enableTools: enabledTools === 'all' ? ['@all'] : enabledTools,
  };
}

export function approvalSelectorsFromMount(value: object): string[] {
  const selectors = Reflect.get(value, 'requireApprovalForTools');
  if (!Array.isArray(selectors)) return [...DEFAULT_APPROVAL_SELECTORS];
  return selectors.filter((selector): selector is string => typeof selector === 'string');
}

/** Drops the field when it matches the harness default so untouched mounts stay clean. */
export function withApprovalSelectors(value: object, selectors: readonly string[]): object {
  if (sameSelectors(selectors, DEFAULT_APPROVAL_SELECTORS)) {
    const next = { ...value };
    Reflect.deleteProperty(next, 'requireApprovalForTools');
    return next;
  }
  return { ...value, requireApprovalForTools: [...selectors] };
}

export function preloadFromMount(value: object): boolean {
  return Reflect.get(value, 'preload') === true;
}

export function withPreload(value: object, preload: boolean): object {
  return { ...value, preload };
}
