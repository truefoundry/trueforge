// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider, useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
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
      <output data-testid="models">{catalog.models.map(model => model.name).join(',')}</output>
      <output data-testid="skills">{catalog.skills.map(skill => skill.name).join(',')}</output>
      <output data-testid="connectors">{catalog.connectors.map(connector => connector.name).join(',')}</output>
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
      models.resolve([{ name: 'openai/gpt-4.1', provider: 'OpenAI' }]);
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
      getModels: async () => [{ name: 'openai/gpt-4.1', provider: 'OpenAI' }],
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
});
