// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider, useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { reconcileDraftSandbox, reconcileDraftSpecPreferences } from '@/atoms/draft/DraftSpecPreferenceBridge.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSkill, ConnectorState, ModelSelection } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

function CatalogProbe() {
  const catalog = useDraftCatalog();

  return (
    <div>
      <button type="button" onClick={() => catalog.ensureLoaded()}>
        Load catalog
      </button>
      <button type="button" onClick={() => catalog.refresh()}>
        Refresh catalog
      </button>
      <button type="button" onClick={() => void catalog.refreshConnectors()}>
        Refresh connectors
      </button>
      <button type="button" onClick={() => catalog.loadMoreConnectors()}>
        Load more connectors
      </button>
      <output data-testid="models">{catalog.models.map(model => model.name).join(',')}</output>
      <output data-testid="skills">{catalog.skills.map(skill => skill.name).join(',')}</output>
      <output data-testid="connectors">{catalog.connectors.map(connector => connector.name).join(',')}</output>
      <output data-testid="connectors-has-more">{String(catalog.connectorsHasMore)}</output>
      <output data-testid="connectors-loading-more">{String(catalog.connectorsLoadingMore)}</output>
      <output data-testid="loading">{String(catalog.loading)}</output>
      <output data-testid="error">{catalog.error ?? ''}</output>
    </div>
  );
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value: T) {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise was not initialized');
      }
      resolvePromise(value);
    },
    reject(reason: unknown) {
      if (rejectPromise === undefined) {
        throw new Error('Deferred promise was not initialized');
      }
      rejectPromise(reason);
    },
  };
}

describe('DraftCatalogProvider', () => {
  it('does not enable sandbox merely because the capability is available for New Agent', () => {
    const update = reconcileDraftSandbox({
      agentSpec: { model: { name: 'model' } },
      sandboxEnabled: true,
      kind: 'agent',
    });

    expect(update).toEqual({});
  });

  it('enables sandbox on New Chat when the capability is available', () => {
    const update = reconcileDraftSandbox({
      agentSpec: { model: { name: 'model' } },
      sandboxEnabled: true,
      kind: 'chat',
    });

    expect(update).toEqual({
      config: { sandbox: { enabled: true } },
    });
  });

  it('disables sandbox on New Chat when the capability becomes unavailable', () => {
    const update = reconcileDraftSandbox({
      agentSpec: { model: { name: 'model' }, config: { sandbox: { enabled: true } } },
      sandboxEnabled: false,
      kind: 'chat',
    });

    expect(update).toEqual({
      config: { sandbox: { enabled: false } },
    });
  });

  it('does not update an active draft whose sandbox already matches capabilities', () => {
    expect(
      reconcileDraftSandbox({
        agentSpec: { model: { name: 'model' }, config: { sandbox: { enabled: true } } },
        sandboxEnabled: true,
        kind: 'agent',
      }),
    ).toEqual({});
    expect(
      reconcileDraftSandbox({
        agentSpec: { model: { name: 'model' }, config: { sandbox: { enabled: true } } },
        sandboxEnabled: true,
        kind: 'chat',
      }),
    ).toEqual({});
  });

  it('does not update an active draft while sandbox capabilities are unavailable', () => {
    const agentSpec = { model: { name: 'model' }, config: { sandbox: { enabled: true } } };

    expect(reconcileDraftSandbox({ agentSpec, sandboxEnabled: undefined, kind: 'agent' })).toEqual({});
    expect(reconcileDraftSandbox({ agentSpec, sandboxEnabled: null, kind: 'agent' })).toEqual({});
    expect(reconcileDraftSandbox({ agentSpec, sandboxEnabled: undefined, kind: 'chat' })).toEqual({});
    expect(reconcileDraftSandbox({ agentSpec, sandboxEnabled: null, kind: 'chat' })).toEqual({});
  });

  it('prunes unavailable remembered choices and falls back to the live model catalog', () => {
    const update = reconcileDraftSpecPreferences({
      agentSpec: {
        model: { name: 'removed/model' },
        skills: [{ name: 'Available skill' }, { name: 'Removed skill' }],
        mcpServers: [{ name: 'Available MCP' }, { name: 'Removed MCP' }],
      },
      models: [
        {
          id: 'live/model',
          name: 'live/model',
          provider: { name: 'Live' },
          properties: { reasoningEfforts: ['none', 'low'] },
        },
      ],
      skills: [{ id: 'available-skill', name: 'Available skill' }],
      connectors: [{ id: 'available-mcp', name: 'Available MCP' }],
      skillsEnabled: true,
    });

    expect(update).toEqual({
      model: { name: 'live/model', params: { reasoningEffort: 'low' } },
      skills: [{ name: 'Available skill' }],
      mcpServers: [{ name: 'Available MCP' }],
    });
  });

  it('keeps off-page MCP mounts while more connector pages remain', () => {
    const update = reconcileDraftSpecPreferences({
      agentSpec: {
        model: { name: 'live/model' },
        mcpServers: [{ name: 'Available MCP' }, { name: 'Off-page MCP' }],
      },
      models: [{ id: 'live/model', name: 'live/model', provider: { name: 'Live' }, properties: {} }],
      skills: [],
      connectors: [{ id: 'available-mcp', name: 'Available MCP' }],
      connectorsHasMore: true,
      skillsEnabled: true,
    });

    expect(update).toEqual({});
  });

  it('clears remembered skills when skills are unavailable', () => {
    const update = reconcileDraftSpecPreferences({
      agentSpec: {
        model: { name: 'live/model' },
        skills: [{ name: 'Skill' }],
      },
      models: [],
      skills: [{ id: 'skill', name: 'Skill' }],
      connectors: [],
      skillsEnabled: false,
    });

    expect(update.skills).toEqual([]);
  });

  it('does not re-clear an already empty skills list when skills are unavailable', () => {
    const emptySkills: object[] = [];
    const update = reconcileDraftSpecPreferences({
      agentSpec: {
        model: { name: 'live/model' },
        skills: emptySkills,
      },
      models: [],
      skills: [],
      connectors: [],
      skillsEnabled: false,
    });

    expect(update).toEqual({});
  });

  it('exposes an empty, idle catalog when used without a provider', () => {
    render(<CatalogProbe />);

    expect(screen.getByTestId('models')).toBeEmptyDOMElement();
    expect(screen.getByTestId('skills')).toBeEmptyDOMElement();
    expect(screen.getByTestId('connectors')).toBeEmptyDOMElement();
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toBeEmptyDOMElement();
  });

  it('loads all catalog collections and publishes them together', async () => {
    const models = deferred<ModelSelection[]>();
    const skills = deferred<AgentSkill[]>();
    const connectors = deferred<ConnectorState[]>();
    const getModels = vi.fn(() => models.promise);
    const getSkills = vi.fn(() => skills.promise);
    const getMcp = vi.fn(() => connectors.promise);
    const server = createMockAgentUIServer({ getModels, getSkills, getMcp });

    render(
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <CatalogProbe />
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(getModels).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }));

    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(getModels).toHaveBeenCalledTimes(1);
    expect(getSkills).toHaveBeenCalledTimes(1);
    expect(getMcp).toHaveBeenCalledTimes(1);

    await act(async () => {
      models.resolve([
        {
          id: 'gpt-4.1',
          name: 'openai/gpt-4.1',
          provider: { name: 'OpenAI' },
          properties: {},
        },
      ]);
      skills.resolve([{ id: 'skill-1', name: 'Release notes' }]);
      connectors.resolve([{ id: 'mcp-1', name: 'GitHub' }]);
      await Promise.all([models.promise, skills.promise, connectors.promise]);
    });

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('models')).toHaveTextContent('openai/gpt-4.1');
    expect(screen.getByTestId('skills')).toHaveTextContent('Release notes');
    expect(screen.getByTestId('connectors')).toHaveTextContent('GitHub');
    expect(screen.getByTestId('error')).toBeEmptyDOMElement();
  });

  it('surfaces catalog failures and leaves loading state', async () => {
    const server = createMockAgentUIServer({
      getModels: async () => {
        throw new Error('Catalog unavailable');
      },
    });

    render(
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <CatalogProbe />
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }));

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Catalog unavailable'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('models')).toBeEmptyDOMElement();
  });

  it('keeps successful lists when a sibling catalog call fails', async () => {
    const server = createMockAgentUIServer({
      getModels: async () => [
        {
          id: 'gpt-4.1',
          name: 'openai/gpt-4.1',
          provider: { name: 'OpenAI' },
          properties: {},
        },
      ],
      getSkills: async () => {
        throw new Error('Skills unavailable');
      },
      getMcp: async () => [{ id: 'mcp-1', name: 'GitHub' }],
    });

    render(
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <CatalogProbe />
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('models')).toHaveTextContent('openai/gpt-4.1');
    expect(screen.getByTestId('connectors')).toHaveTextContent('GitHub');
    expect(screen.getByTestId('skills')).toBeEmptyDOMElement();
    expect(screen.getByTestId('error')).toHaveTextContent('Skills unavailable');
  });

  it('refreshes connectors without reloading models or skills', async () => {
    const getModels = vi.fn(async (): Promise<ModelSelection[]> => [
      {
        id: 'gpt-4.1',
        name: 'openai/gpt-4.1',
        provider: { name: 'OpenAI' },
        properties: {},
      },
    ]);
    const getSkills = vi.fn(async () => [{ id: 'skill-1', name: 'Release notes' }]);
    const getMcp = vi
      .fn<() => Promise<ConnectorState[]>>()
      .mockResolvedValueOnce([{ id: 'linear', name: 'Linear', authenticated: false }])
      .mockResolvedValueOnce([{ id: 'linear', name: 'Linear', authenticated: true }]);
    const server = createMockAgentUIServer({ getModels, getSkills, getMcp });

    render(
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <CatalogProbe />
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }));
    await waitFor(() => expect(getMcp).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh connectors' }));

    await waitFor(() => expect(getMcp).toHaveBeenCalledTimes(2));
    expect(getModels).toHaveBeenCalledTimes(1);
    expect(getSkills).toHaveBeenCalledTimes(1);
  });

  it('reloads every collection when the catalog is refreshed', async () => {
    const getModels = vi.fn(async (): Promise<ModelSelection[]> => []);
    const getSkills = vi.fn(async (): Promise<AgentSkill[]> => []);
    const getMcp = vi.fn(async (): Promise<ConnectorState[]> => []);
    const server = createMockAgentUIServer({ getModels, getSkills, getMcp });

    render(
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <CatalogProbe />
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }));
    await waitFor(() => expect(getModels).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' }));

    await waitFor(() => expect(getModels).toHaveBeenCalledTimes(2));
    expect(getSkills).toHaveBeenCalledTimes(2);
    expect(getMcp).toHaveBeenCalledTimes(2);
  });

  it('uses the nearest server when catalog providers are nested', async () => {
    const outerGetModels = vi.fn(async () => []);
    const innerGetModels = vi.fn(async () => [
      {
        id: 'inner-model',
        name: 'inner/model',
        provider: { name: 'Inner' },
        properties: {},
      },
    ]);
    const outerServer = createMockAgentUIServer({ getModels: outerGetModels });
    const innerServer = createMockAgentUIServer({ getModels: innerGetModels });

    render(
      <ServerProvider server={outerServer}>
        <DraftCatalogProvider>
          <ServerProvider server={innerServer}>
            <DraftCatalogProvider>
              <CatalogProbe />
            </DraftCatalogProvider>
          </ServerProvider>
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }));

    await waitFor(() => expect(screen.getByTestId('models')).toHaveTextContent('inner/model'));
    expect(innerGetModels).toHaveBeenCalledOnce();
    expect(outerGetModels).not.toHaveBeenCalled();
  });

  it('loads the first MCP page via listMcp and appends on loadMoreConnectors', async () => {
    const listMcp = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: 'a', name: 'Alpha' }],
        nextPageToken: 'page-2',
      })
      .mockResolvedValueOnce({
        data: [{ id: 'b', name: 'Beta' }],
      });
    const getMcp = vi.fn(async (): Promise<ConnectorState[]> => {
      throw new Error('getMcp should not run when listMcp is present');
    });
    const server = createMockAgentUIServer({ listMcp, getMcp });

    render(
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <CatalogProbe />
        </DraftCatalogProvider>
      </ServerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }));

    await waitFor(() => expect(screen.getByTestId('connectors')).toHaveTextContent('Alpha'));
    expect(screen.getByTestId('connectors-has-more')).toHaveTextContent('true');
    expect(listMcp).toHaveBeenCalledWith({ limit: 50 });
    expect(getMcp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load more connectors' }));

    await waitFor(() => expect(screen.getByTestId('connectors')).toHaveTextContent('Alpha,Beta'));
    expect(screen.getByTestId('connectors-has-more')).toHaveTextContent('false');
    expect(listMcp).toHaveBeenCalledWith({ limit: 50, pageToken: 'page-2' });
  });
});
