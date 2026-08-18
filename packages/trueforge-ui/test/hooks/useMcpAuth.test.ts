// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorCatalogServer } from '@/server/types.js';

type CatalogHookValue = {
  connectorCatalog: Pick<ConnectorCatalogServer, 'authenticateConnector'>;
};

type ToasterValue = {
  showError: (error: unknown) => void;
};

const useCatalogServer = vi.hoisted(() => vi.fn<() => CatalogHookValue>());
const useToasterOptional = vi.hoisted(() => vi.fn<() => ToasterValue | null>());

vi.mock('@/server/ServerContext.js', () => ({
  useCatalogServer,
}));

vi.mock('@/containers/ToasterContainer.js', () => ({
  useToasterOptional,
}));

import { MCP_AUTH_POPUP_CHANNEL, useMCPAuth } from '@/hooks/useMcpAuth.js';

const channels: BroadcastChannelStub[] = [];

class BroadcastChannelStub {
  readonly name: string;
  readonly close = vi.fn();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    channels.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const authenticateConnector = vi.fn<ConnectorCatalogServer['authenticateConnector']>();
const showError = vi.fn<(error: unknown) => void>();

function getPopupUid(): string {
  const call = authenticateConnector.mock.calls.at(-1);
  if (!call) throw new Error('Expected authenticateConnector to be called');

  const returnTo = call[0].returnTo;
  if (!returnTo) throw new Error('Expected authenticateConnector to receive a returnTo');

  const popupUid = new URL(returnTo, window.location.origin).searchParams.get('pUid');
  if (!popupUid) throw new Error('Expected returnTo to contain a popup UID');
  return popupUid;
}

describe('useMCPAuth', () => {
  beforeEach(() => {
    channels.length = 0;
    authenticateConnector.mockReset();
    showError.mockReset();
    useCatalogServer.mockReset();
    useToasterOptional.mockReset();
    useCatalogServer.mockReturnValue({
      connectorCatalog: { authenticateConnector },
    });
    useToasterOptional.mockReturnValue({ showError });
    vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);
    window.history.replaceState({}, '', '/chat');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('completes immediately when the connector is already authenticated', async () => {
    authenticateConnector.mockResolvedValue({ status: 'AUTHENTICATED' });
    const open = vi.spyOn(window, 'open');
    const callback = vi.fn();
    const { result } = renderHook(() => useMCPAuth());

    await act(async () => {
      await result.current.handleAuthorize('connector-1', callback);
    });

    expect(authenticateConnector).toHaveBeenCalledWith({
      id: 'connector-1',
      returnTo: expect.stringMatching(/^\/chat\?/),
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(true);
    expect(open).not.toHaveBeenCalled();
    expect(channels).toHaveLength(0);
    expect(showError).not.toHaveBeenCalled();
    expect(result.current.isOAuthLoading).toBe(false);
  });

  it('opens the authorization endpoint and accepts only its matching channel result', async () => {
    authenticateConnector.mockResolvedValue({
      authorization_endpoint: 'https://auth.example.test/authorize',
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(window);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const callback = vi.fn();
    const { result } = renderHook(() => useMCPAuth({ callbackPath: '/oauth/callback' }));

    await act(async () => {
      await result.current.handleAuthorize('connector-2', callback);
    });

    expect(open).toHaveBeenCalledWith('https://auth.example.test/authorize', '_blank', 'popup=true');
    expect(focus).toHaveBeenCalledOnce();
    expect(channels).toHaveLength(1);
    expect(channels[0]?.name).toBe(MCP_AUTH_POPUP_CHANNEL);

    const redirectCall = authenticateConnector.mock.calls[0];
    const returnTo = redirectCall?.[0].returnTo;
    if (!returnTo) throw new Error('Expected a returnTo');
    expect(returnTo.startsWith('/')).toBe(true);
    expect(returnTo.includes('://')).toBe(false);
    const returnToUrl = new URL(returnTo, window.location.origin);
    expect(returnToUrl.pathname).toBe('/oauth/callback');
    expect(returnToUrl.searchParams.get('screenType')).toBe('mcp-auth');
    expect(returnToUrl.searchParams.get('integrationId')).toBe('connector-2');

    const channel = channels[0];
    if (!channel) throw new Error('Expected an authorization channel');
    channel.emit(null);
    channel.emit({ popupUid: getPopupUid() });
    channel.emit({ popupUid: 'another-popup', isSuccess: true });

    expect(callback).not.toHaveBeenCalled();
    expect(channel.close).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    channel.emit({ popupUid: getPopupUid(), isSuccess: true });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(true);
    expect(channel.close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(showError).not.toHaveBeenCalled();
  });

  it('reports a blocked popup and completes authorization as failed', async () => {
    authenticateConnector.mockResolvedValue({
      authorization_endpoint: 'https://auth.example.test/authorize',
    });
    vi.spyOn(window, 'open').mockReturnValue(null);
    const callback = vi.fn();
    const { result } = renderHook(() => useMCPAuth());

    await act(async () => {
      await result.current.handleAuthorize('connector-3', callback);
    });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(false);
    expect(showError).toHaveBeenCalledOnce();
    expect(showError).toHaveBeenCalledWith(
      new Error('Popup blocked. Please allow pop-ups to authorize the MCP server.'),
    );
    expect(channels[0]?.close).toHaveBeenCalledOnce();
    expect(result.current.isOAuthLoading).toBe(false);
  });

  it('closes the channel and popup when the hook unmounts', async () => {
    authenticateConnector.mockResolvedValue({
      authorization_endpoint: 'https://auth.example.test/authorize',
    });
    vi.spyOn(window, 'open').mockReturnValue(window);
    vi.spyOn(window, 'focus').mockImplementation(() => {});
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useMCPAuth());

    await act(async () => {
      await result.current.handleAuthorize('connector-4', callback);
    });

    const channel = channels[0];
    if (!channel) throw new Error('Expected an authorization channel');
    expect(channel.close).not.toHaveBeenCalled();

    unmount();

    expect(channel.close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });
});
