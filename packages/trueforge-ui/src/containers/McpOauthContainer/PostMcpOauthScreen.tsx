'use client';

import { useEffect, useState } from 'react';

import { MCP_AUTH_POPUP_CHANNEL, type McpAuthPopupMessage } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';

const BROADCAST_RETRY_DELAY_MS = 1000;
const WINDOW_CLOSE_DELAY_MS = 5000;

/**
 * Prefer `isSuccess` when present; otherwise treat a `code` without `error` as success.
 */
function resolvePopupSuccess(searchParams: URLSearchParams): boolean {
  if (searchParams.get('error')) {
    return false;
  }
  const flag = searchParams.get('isSuccess')?.toLowerCase();
  if (flag === 'true') {
    return true;
  }
  if (flag === 'false') {
    return false;
  }
  const code = searchParams.get('code');
  return code != null && code.length > 0;
}

const PostMcpOauthScreen = () => {
  const [result, setResult] = useState<McpAuthPopupMessage | null>();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const popupUid = searchParams.get('pUid');
    const isSuccess = resolvePopupSuccess(searchParams);
    setResult(popupUid ? { popupUid, isSuccess } : null);

    const broadcastResult = () => {
      if (!popupUid) return;

      const channel = new BroadcastChannel(MCP_AUTH_POPUP_CHANNEL);
      const message: McpAuthPopupMessage = { popupUid, isSuccess };
      channel.postMessage(message);
      channel.close();
    };

    broadcastResult();
    const retryTimeout = window.setTimeout(broadcastResult, BROADCAST_RETRY_DELAY_MS);
    const closeTimeout = window.setTimeout(() => {
      window.close();
    }, WINDOW_CLOSE_DELAY_MS);

    return () => {
      window.clearTimeout(retryTimeout);
      window.clearTimeout(closeTimeout);
    };
  }, []);

  const isSuccess = !!result?.isSuccess;
  const title =
    result === undefined ? 'Completing authorization' : isSuccess ? 'Authorization successful' : 'Authorization failed';
  const description =
    result === undefined
      ? 'Please wait while the authorization result is confirmed.'
      : result === null
        ? 'The authorization result is invalid. You can close this window and try again.'
        : isSuccess
          ? 'The MCP server is now connected. This window will close automatically.'
          : 'The MCP server could not be authorized. You can close this window and try again.';

  return (
    <main className="flex min-h-screen items-center justify-center bg-primary-bg p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card-bg p-8 text-center shadow-sm">
        {result === undefined ? (
          <Icon name="oauth-loading" className="size-16 animate-spin text-text-secondary" />
        ) : isSuccess ? (
          <Icon name="oauth-success" className="size-16 text-success-bg" />
        ) : (
          <Icon name="oauth-error" className="size-16 text-failure-bg" />
        )}
        <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
        <p className="text-sm leading-6 text-text-secondary">{description}</p>
      </div>
    </main>
  );
};

export default PostMcpOauthScreen;
