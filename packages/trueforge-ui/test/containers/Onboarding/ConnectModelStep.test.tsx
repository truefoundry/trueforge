// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConnectModelStep } from '@/containers/Onboarding/ConnectModelStep.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { CreateModelProviderRequest, ModelProviderBase, ModelProviderCatalogEntry } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

const catalogEntries: ModelProviderCatalogEntry[] = [
  { type: 'openai', name: 'openai', models: [{ id: 'gpt-4.1', name: 'gpt-4-1' }] },
  { type: 'anthropic', name: 'anthropic', models: [{ id: 'claude', name: 'claude' }] },
  { type: 'custom', name: 'custom', models: [] },
];

function renderStep({
  createModelProvider = vi.fn(async (request: CreateModelProviderRequest): Promise<ModelProviderBase> => ({
    id: 'p1',
    ...request,
  })),
  connectedType,
  onConnected = vi.fn(),
}: {
  createModelProvider?: (request: CreateModelProviderRequest) => Promise<ModelProviderBase>;
  connectedType?: string;
  onConnected?: (providerType: string) => void;
} = {}) {
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({
      modelCatalog: {
        getModelProviderCatalog: async () => catalogEntries,
        listModelProviders: async () => [],
        createModelProvider,
        updateModelProvider: vi.fn(),
      },
    }),
  });
  render(
    <ServerProvider server={server}>
      <ConnectModelStep connectedType={connectedType} onConnected={onConnected} />
    </ServerProvider>,
  );
  return { createModelProvider, onConnected };
}

describe('ConnectModelStep', () => {
  it('lists catalog providers without the custom one and preselects the first', async () => {
    renderStep();
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('disables Continue until an API key is entered', async () => {
    renderStep();
    const continueButton = await screen.findByRole('button', { name: /Continue/ });
    expect(continueButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test' } });
    expect(continueButton).toBeEnabled();
  });

  it('creates the selected provider with the key and advances', async () => {
    const { createModelProvider, onConnected } = renderStep();
    fireEvent.click(await screen.findByRole('option', { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: ' sk-test ' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('anthropic'));
    expect(createModelProvider).toHaveBeenCalledWith({
      type: 'anthropic',
      name: 'anthropic',
      apiKey: 'sk-test',
      models: catalogEntries[1]?.models,
    });
  });

  it('sends the custom endpoint from the advanced section', async () => {
    const { createModelProvider } = renderStep();
    await screen.findAllByRole('option');
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://proxy.example/v1' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await waitFor(() => expect(createModelProvider).toHaveBeenCalled());
    expect(createModelProvider).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openai', baseUrl: 'https://proxy.example/v1', apiKey: 'sk-test' }),
    );
  });

  it('shows the error and stays on the step when saving fails', async () => {
    const { onConnected } = renderStep({ createModelProvider: () => Promise.reject(new Error('Invalid key')) });
    await screen.findAllByRole('option');
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid key');
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('advances without creating a duplicate when returning from the next step', async () => {
    const { createModelProvider, onConnected } = renderStep({ connectedType: 'anthropic' });
    const continueButton = await screen.findByRole('button', { name: /Continue/ });
    expect(screen.getByLabelText('API key')).toBeDisabled();
    fireEvent.click(continueButton);

    expect(onConnected).toHaveBeenCalledWith('anthropic');
    expect(createModelProvider).not.toHaveBeenCalled();
  });
});
