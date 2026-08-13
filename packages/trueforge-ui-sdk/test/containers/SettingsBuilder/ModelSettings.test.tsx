// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CustomProviderDraft } from '@/containers/SettingsBuilder/CustomModelProviderForm.js';
import ModelSettings from '@/containers/SettingsBuilder/ModelSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ModelProviderBase, UpdateModelProviderRequest } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const customProvider: ModelProviderBase<CustomProviderDraft['models'][number]> = {
  id: 'local-llama',
  type: 'custom',
  name: 'local-llama',
  baseUrl: 'http://localhost:11434/v1',
  models: [
    {
      id: 'llama3.1:70b',
      name: 'llama-3-1-70b',
      properties: {
        contextLength: 64000,
        maxOutputTokens: 2048,
        reasoningEfforts: ['high'],
      },
    },
  ],
};

const builtInProvider: ModelProviderBase = {
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  models: [{ id: 'gpt-4.1', name: 'gpt-4-1' }],
};

describe('ModelSettings custom provider editing', () => {
  it('opens the custom provider modal from Edit and updates the provider from the prefilled form', async () => {
    const updateModelProvider = vi.fn(async (request: UpdateModelProviderRequest) => ({
      ...customProvider,
      baseUrl: request.baseUrl,
      models: request.models,
    }));
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        modelCatalog: {
          getModelProviderCatalog: async () => [
            {
              type: 'custom',
              name: 'custom',
              models: [],
              supportedReasoningEfforts: ['low', 'high'],
            },
          ],
          listModelProviders: async () => [customProvider, builtInProvider],
          createModelProvider: vi.fn(),
          updateModelProvider,
        },
      }),
    });

    render(
      <ServerProvider server={server}>
        <ModelSettings />
      </ServerProvider>,
    );

    const editButton = await screen.findByRole('button', { name: 'Edit local-llama' });
    expect(screen.getByRole('button', { name: 'Edit OpenAI' })).toBeInTheDocument();
    fireEvent.click(editButton);

    expect(screen.getByRole('heading', { name: 'Edit local-llama' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('local-llama')).toHaveValue('local-llama');
    expect(screen.getByPlaceholderText('local-llama')).toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText('http://localhost:11434/v1')).toHaveValue('http://localhost:11434/v1');
    expect(screen.getByPlaceholderText('llama3.1:70b')).toHaveValue('llama3.1:70b');
    expect(screen.getByPlaceholderText('128000')).toHaveValue(64000);
    expect(screen.getByPlaceholderText('4096')).toHaveValue(2048);

    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateModelProvider).toHaveBeenCalledTimes(1));
    expect(updateModelProvider).toHaveBeenCalledWith({
      id: 'local-llama',
      type: 'custom',
      name: 'local-llama',
      baseUrl: 'http://localhost:11434/v2',
      apiKey: '',
      models: customProvider.models,
    });
  });
});
