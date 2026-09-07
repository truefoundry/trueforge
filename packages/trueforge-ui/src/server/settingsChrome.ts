import type { CatalogServer } from './types.js';

/**
 * Whether Settings chrome is available: sidebar button and `/settings` route.
 * Matches the gate in {@link ShellActions}.
 */
export function isSettingsChromeEnabled({
  catalog,
  capabilities,
}: {
  catalog: CatalogServer | null | undefined;
  capabilities: { settings?: { enabled?: boolean } } | null | undefined;
}): boolean {
  return catalog != null && capabilities?.settings?.enabled !== false;
}
