import { describe, expect, it } from 'vitest';

import { connectorsWithSelectedStubs } from '@/atoms/draft/mcpConnectorStubs.js';

describe('connectorsWithSelectedStubs', () => {
  it('returns connectors unchanged when every selection is present', () => {
    const connectors = [{ id: 'a', name: 'A' }];
    expect(connectorsWithSelectedStubs({ connectors, selected: [{ id: 'a', name: 'A' }] })).toBe(connectors);
  });

  it('prepends stubs for selected mounts missing from the loaded page', () => {
    expect(
      connectorsWithSelectedStubs({
        connectors: [{ id: 'b', name: 'B' }],
        selected: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      }),
    ).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });
});
