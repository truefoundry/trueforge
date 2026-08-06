// @vitest-environment jsdom
import type { AppendMessage } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComposerBusyProvider } from '../hooks/useComposerBusyState.js';
import { ShellModeProvider } from '../server/ShellModeContext.js';
import { SlotsProvider } from '../theme/SlotsProvider.js';
import { ComposerContainer } from './ComposerContainer.js';
import { RuntimeHarness } from './RuntimeHarness.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryCancel: () => vi.fn(),
  useTrueFoundryToolResponses: () => ({ pending: [] }),
}));

function renderComposer(onNew?: (message: AppendMessage) => Promise<void>) {
  return render(
    <RuntimeHarness messages={[]} onNew={onNew}>
      <ComposerBusyProvider>
        <ComposerContainer />
      </ComposerBusyProvider>
    </RuntimeHarness>,
  );
}

describe('ComposerContainer', () => {
  it('wraps the composer in an attachment dropzone by default', () => {
    renderComposer();
    const dropzone = document.querySelector('[data-slot="aui_composer-attachment-dropzone"]');
    expect(dropzone).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeInTheDocument();
  });

  it('marks the dropzone as dragging on drag enter', () => {
    renderComposer();
    const dropzone = document.querySelector('[data-slot="aui_composer-attachment-dropzone"]');
    expect(dropzone).not.toBeNull();
    fireEvent.dragEnter(dropzone!);
    expect(dropzone).toHaveAttribute('data-dragging', 'true');
  });

  it('keeps the caret in place when text is inserted mid-string', () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: 'Message input' }) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'hello world' } });
    fireEvent.change(input, {
      target: { value: 'hello Xworld', selectionStart: 7, selectionEnd: 7 },
    });

    expect(input.value).toBe('hello Xworld');
    expect(input.selectionStart).toBe(7);
  });

  it('submits once on Enter and inserts a newline on Shift+Enter', async () => {
    const onNew = vi.fn(async () => {});
    renderComposer(onNew);
    const input = screen.getByRole('textbox', { name: 'Message input' }) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onNew).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe(''));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('preserves consumer section overrides in draft mode', () => {
    render(
      <SlotsProvider
        overrides={{
          ComposerLeftSection: () => <div>Custom left</div>,
          ComposerRightSection: () => <div>Custom right</div>,
        }}
      >
        <ShellModeProvider
          agentConfig={{
            mode: 'AgentComposer',
            defaultAgentSpec: { model: { name: 'test/model' } },
          }}
        >
          <RuntimeHarness messages={[]}>
            <ComposerBusyProvider>
              <ComposerContainer />
            </ComposerBusyProvider>
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );

    expect(screen.getByText('Custom left')).toBeInTheDocument();
    expect(screen.getByText('Custom right')).toBeInTheDocument();
  });
});
