// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenEditorButton, TokenEditorModal } from '@/atoms/TokenEditor.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
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

function getThemeRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.aui-theme-root');
  if (root === null) throw new Error('Expected theme root');
  return root;
}

describe('TokenEditorButton', () => {
  it('renders nothing unless devTokens is enabled', () => {
    const { container, rerender } = render(
      <ThemeProvider theme={{ preset: 'truefoundry', mode: 'light' }}>
        <TokenEditorButton />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Tokens (For Dev)' })).toBeNull();

    rerender(
      <ThemeProvider theme={{ preset: 'truefoundry', mode: 'light', devTokens: true }}>
        <TokenEditorButton />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Tokens (For Dev)' })).toBeInTheDocument();
    expect(container).toBeTruthy();
  });
});

describe('TokenEditorModal', () => {
  it('seeds inputs from the resolved palette and applies edits on save', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'truefoundry', mode: 'light', devTokens: true }}>
        <TokenEditorModal open onOpenChange={() => undefined} />
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);

    const backgroundInput = screen.getByLabelText('--background');
    expect(backgroundInput).toHaveValue('#ffffff');

    const primaryInput = screen.getByLabelText('--primary');
    expect(primaryInput).toHaveValue('#09090b');

    fireEvent.change(primaryInput, { target: { value: '#ff0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(root.style.getPropertyValue('--primary')).toBe('#ff0000');
    expect(localStorage.getItem('aui-theme-token-overrides')).toContain('#ff0000');
  });

  it('reset reverts edits back to the preset default', () => {
    localStorage.setItem('aui-theme-token-overrides', JSON.stringify({ light: { primary: '#abcdef' } }));
    const { container } = render(
      <ThemeProvider theme={{ preset: 'truefoundry', mode: 'light', devTokens: true }}>
        <TokenEditorModal open onOpenChange={() => undefined} />
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.style.getPropertyValue('--primary')).toBe('#abcdef');

    act(() => {
      screen.getByRole('button', { name: 'Reset to defaults' }).click();
    });

    expect(root.style.getPropertyValue('--primary')).toBe('#09090b');
    expect(screen.getByLabelText('--primary')).toHaveValue('#09090b');
  });
});
