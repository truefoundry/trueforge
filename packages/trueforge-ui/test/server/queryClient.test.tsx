// @vitest-environment jsdom
import { onlineManager } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider, useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { useServerQueryClient } from '@/server/queryClient.js';
import { ServerProvider, useServerCapabilities } from '@/server/ServerContext.js';
import type { AgentBuilderCapabilitiesResponse } from '@/server/types.js';

import { createMockAgentUIServer } from './mockServer.js';

function capabilitiesResponse(settingsEnabled: boolean): AgentBuilderCapabilitiesResponse {
  return {
    data: { sandbox: { enabled: true }, skill: { enabled: true }, settings: { enabled: settingsEnabled } },
  };
}

function CapabilitiesProbe() {
  const capabilities = useServerCapabilities();
  return <output>{capabilities == null ? 'pending' : String(capabilities.settings?.enabled)}</output>;
}

function CatalogProbe({ label }: { label: string }) {
  const { ensureLoaded, loaded } = useDraftCatalog();
  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);
  return <output>{`${label}:${loaded ? 'loaded' : 'loading'}`}</output>;
}

describe('ServerProvider query cache', () => {
  it('shares one catalog request across separate catalog providers', async () => {
    const getModels = vi.fn(async () => []);
    const server = createMockAgentUIServer({ getModels });

    render(
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <CatalogProbe label="first" />
        </DraftCatalogProvider>
        <DraftCatalogProvider>
          <CatalogProbe label="second" />
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    await screen.findByText('first:loaded');
    await screen.findByText('second:loaded');
    expect(getModels).toHaveBeenCalledTimes(1);
  });

  it('resumes a request paused while the browser was offline', async () => {
    const getCapabilities = vi.fn(async () => capabilitiesResponse(true));
    onlineManager.setOnline(false);
    try {
      render(
        <ServerProvider server={createMockAgentUIServer({ getCapabilities })}>
          <CapabilitiesProbe />
        </ServerProvider>,
      );
      expect(screen.getByText('pending')).toBeTruthy();
      expect(getCapabilities).not.toHaveBeenCalled();

      act(() => onlineManager.setOnline(true));

      await screen.findByText('true');
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('keeps one isolated client per consumer outside ServerProvider', () => {
    const { result, rerender } = renderHook(() => useServerQueryClient());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('does not reuse the previous server cache after a server swap', async () => {
    const firstCapabilities = vi.fn(async () => capabilitiesResponse(true));
    const secondCapabilities = vi.fn(async () => capabilitiesResponse(false));
    const { rerender } = render(
      <ServerProvider server={createMockAgentUIServer({ getCapabilities: firstCapabilities })}>
        <CapabilitiesProbe />
      </ServerProvider>,
    );
    await screen.findByText('true');

    rerender(
      <ServerProvider server={createMockAgentUIServer({ getCapabilities: secondCapabilities })}>
        <CapabilitiesProbe />
      </ServerProvider>,
    );

    await screen.findByText('false');
    expect(firstCapabilities).toHaveBeenCalledTimes(1);
    expect(secondCapabilities).toHaveBeenCalledTimes(1);
  });
});
