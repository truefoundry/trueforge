// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activeThread = vi.hoisted(() => ({ remoteId: null as string | null }));

vi.mock('@/assistant-ui.js', () => ({
  useAuiState: (selector: (state: { threadListItem: { remoteId: string | null } }) => unknown) =>
    selector({ threadListItem: { remoteId: activeThread.remoteId } }),
}));

import { ShareChatButton } from '@/atoms/ShareChatButton.js';
import { resolveRoutesConfig } from '@/routing/paths.js';
import { ResolvedRoutesProvider } from '@/routing/ResolvedRoutesContext.js';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  activeThread.remoteId = null;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
});

describe('ShareChatButton', () => {
  it('is hidden until the active chat has a persisted session id', () => {
    render(<ShareChatButton />);

    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('copies the routed shared-session URL', async () => {
    activeThread.remoteId = 'session-1';
    render(
      <ResolvedRoutesProvider routes={resolveRoutesConfig()}>
        <ShareChatButton />
      </ResolvedRoutesProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    expect(new URL(String(writeText.mock.calls[0]?.[0])).pathname).toBe('/sessions/share/session-1');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
