// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PostMcpOauthScreen from '@/containers/McpOauthContainer/PostMcpOauthScreen.js';
import { MCP_AUTH_POPUP_CHANNEL } from '@/hooks/useMcpAuth.js';

const channels: BroadcastChannelStub[] = [];

class BroadcastChannelStub {
  readonly name: string;
  readonly postMessage = vi.fn();
  readonly close = vi.fn();

  constructor(name: string) {
    this.name = name;
    channels.push(this);
  }
}

describe('PostMcpOauthScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    channels.length = 0;
    vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);
    vi.spyOn(window, 'close').mockImplementation(() => {});
    window.history.replaceState({}, '', '/oauth/callback');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads a successful result from the URL and broadcasts it immediately and once more', () => {
    window.history.replaceState({}, '', '/oauth/callback?pUid=popup-123&isSuccess=TrUe');

    render(<PostMcpOauthScreen />);

    expect(screen.getByRole('heading', { name: 'Authorization successful' })).toBeInTheDocument();
    expect(channels).toHaveLength(1);
    expect(channels[0]?.name).toBe(MCP_AUTH_POPUP_CHANNEL);
    expect(channels[0]?.postMessage).toHaveBeenCalledWith({
      popupUid: 'popup-123',
      isSuccess: true,
    });
    expect(channels[0]?.close).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(channels).toHaveLength(2);
    expect(channels[1]?.postMessage).toHaveBeenCalledWith({
      popupUid: 'popup-123',
      isSuccess: true,
    });
    expect(channels[1]?.close).toHaveBeenCalledOnce();
  });

  it('renders and broadcasts a failed authorization result', () => {
    window.history.replaceState({}, '', '/oauth/callback?pUid=popup-456&isSuccess=false');

    render(<PostMcpOauthScreen />);

    expect(screen.getByRole('heading', { name: 'Authorization failed' })).toBeInTheDocument();
    expect(channels[0]?.postMessage).toHaveBeenCalledWith({
      popupUid: 'popup-456',
      isSuccess: false,
    });
  });

  it('does not broadcast an invalid result but still closes the popup after five seconds', () => {
    window.history.replaceState({}, '', '/oauth/callback?isSuccess=true');

    render(<PostMcpOauthScreen />);

    expect(screen.getByRole('heading', { name: 'Authorization failed' })).toBeInTheDocument();
    expect(screen.getByText(/authorization result is invalid/i)).toBeInTheDocument();
    expect(channels).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(window.close).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(window.close).toHaveBeenCalledOnce();
  });

  it('clears the retry and close timers when unmounted', () => {
    window.history.replaceState({}, '', '/oauth/callback?pUid=popup-cleanup&isSuccess=true');
    const { unmount } = render(<PostMcpOauthScreen />);

    expect(channels).toHaveLength(1);
    unmount();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(channels).toHaveLength(1);
    expect(window.close).not.toHaveBeenCalled();
  });
});
