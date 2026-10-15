// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentResourceConfigModal } from '@/atoms/draft/AgentResourceConfigModal.js';
import type { AgentSpec } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const showModal = vi.fn(function showModal(this: HTMLDialogElement) {
  this.open = true;
});
const close = vi.fn(function close(this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
});

beforeEach(() => {
  showModal.mockClear();
  close.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: close,
  });
});

afterEach(() => {
  if (originalShowModal === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  }
  if (originalClose === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  }
});

const emptySpec: AgentSpec = { model: { name: 'openai/gpt' } };

const baseProps = {
  spec: emptySpec,
  connectors: [],
  skills: [],
  skillsDisabled: false,
  query: '',
  activeConnectorId: null,
  tools: [],
  connectorLoading: false,
  connectorError: null,
  toolsLoading: false,
  toolsError: null,
  onQueryChange: () => undefined,
  onSelectConnector: () => undefined,
  onRetryTools: () => undefined,
  onChange: () => undefined,
  onClose: () => undefined,
};

describe('AgentResourceConfigModal', () => {
  it('renders AgentSkillsHeaderActionSlot next to the Skills title', () => {
    render(
      <SlotsProvider
        overrides={{
          AgentSkillsHeaderActionSlot: () => <a href="/skills">Register Skills</a>,
          AgentResourceEditorContent: () => <div>skills body</div>,
        }}
      >
        <AgentResourceConfigModal editor="skills" {...baseProps} />
      </SlotsProvider>,
    );

    const title = screen.getByRole('heading', { name: 'Skills' });
    const accessory = screen.getByRole('link', { name: 'Register Skills' });
    expect(title.nextElementSibling).toBe(accessory);
  });

  it('does not render the skills header slot for the MCP editor', () => {
    render(
      <SlotsProvider
        overrides={{
          AgentSkillsHeaderActionSlot: () => <a href="/skills">Register Skills</a>,
          AgentResourceEditorContent: () => <div>mcp body</div>,
        }}
      >
        <AgentResourceConfigModal editor="mcp" {...baseProps} />
      </SlotsProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Select MCP Tools' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register Skills' })).not.toBeInTheDocument();
  });
});
