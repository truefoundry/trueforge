// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import WebSearchSettings from '@/containers/SettingsBuilder/WebSearchSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type {
  CreateWebSearchProviderRequest,
  UpdateWebSearchProviderRequest,
  WebSearchProviderBase,
  WebSearchProviderCatalogEntry,
} from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const catalogEntry: WebSearchProviderCatalogEntry = {
  id: 'parallel',
  name: 'Parallel',
  type: 'parallel',
};

function createFakeHost(initial: WebSearchProviderBase[] = []) {
  let providers = [...initial];
  const created: CreateWebSearchProviderRequest[] = [];
  const updated: UpdateWebSearchProviderRequest[] = [];

  const webSearchCatalog = {
    getWebSearchProviderCatalog: async () => [catalogEntry],
    listWebSearchProviders: async () => providers,
    createWebSearchProvider: async (req: CreateWebSearchProviderRequest) => {
      created.push(req);
      const provider: WebSearchProviderBase = {
        id: req.catalogId,
        name: req.name,
        catalogId: req.catalogId,
        isConnected: true,
      };
      providers = [...providers, provider];
      return provider;
    },
    updateWebSearchProvider: async (req: UpdateWebSearchProviderRequest) => {
      updated.push(req);
      const next = providers.find(provider => provider.id === req.id);
      if (next === undefined) {
        throw new Error(`Web search provider "${req.id}" not found`);
      }
      return next;
    },
  };

  const server = createMockAgentUIServer({
    catalog: createMockCatalog({ webSearchCatalog }),
  });

  return {
    created,
    updated,
    wrapper: ({ children }: { children: ReactNode }) => <ServerProvider server={server}>{children}</ServerProvider>,
  };
}

describe('WebSearchSettings', () => {
  it('requires apiKey on create', async () => {
    const host = createFakeHost();
    const { wrapper: Wrapper } = host;
    render(
      <Wrapper>
        <WebSearchSettings />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Parallel')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));

    await waitFor(() => {
      expect(screen.getByLabelText('API key')).toBeTruthy();
    });
    expect(screen.getByLabelText('API key')).toHaveProperty('value', '');

    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'par_secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(host.created).toHaveLength(1);
    });
    expect(host.created[0]).toMatchObject({
      catalogId: 'parallel',
      name: 'Parallel',
      type: 'parallel',
      apiKey: 'par_secret',
    });
  });

  it('allows update without re-entering apiKey', async () => {
    const existing: WebSearchProviderBase = {
      id: 'parallel',
      name: 'Parallel',
      catalogId: 'parallel',
      isConnected: true,
    };
    const host = createFakeHost([existing]);
    const { wrapper: Wrapper } = host;
    render(
      <Wrapper>
        <WebSearchSettings />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/API key/)).toHaveProperty('value', '');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(host.updated).toHaveLength(1);
    });
    expect(host.updated[0]).toEqual({
      id: 'parallel',
    });
    expect(host.updated[0]).not.toHaveProperty('apiKey');
  });

  it('hides other catalog providers once one is configured', async () => {
    const existing: WebSearchProviderBase = {
      id: 'parallel',
      name: 'Parallel',
      catalogId: 'parallel',
      isConnected: true,
    };
    const host = createFakeHost([existing]);
    const { wrapper: Wrapper } = host;
    render(
      <Wrapper>
        <WebSearchSettings />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Web search')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
    expect(screen.queryByText(/^Available ·/)).toBeNull();
  });
});
