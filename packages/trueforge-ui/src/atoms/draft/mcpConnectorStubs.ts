import type { ConnectorState } from '../../server/types.js';

/** Keep selected mounts visible when they are not yet on a loaded MCP page. */
export function connectorsWithSelectedStubs({
  connectors,
  selected,
}: {
  connectors: ConnectorState[];
  selected: ReadonlyArray<{ id: string; name: string }>;
}): ConnectorState[] {
  if (selected.length === 0) return connectors;
  const byId = new Map(connectors.map(connector => [connector.id, connector]));
  const stubs: ConnectorState[] = [];
  for (const mount of selected) {
    if (!byId.has(mount.id)) {
      stubs.push({ id: mount.id, name: mount.name });
    }
  }
  return stubs.length === 0 ? connectors : [...stubs, ...connectors];
}
