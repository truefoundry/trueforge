'use client';

import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { MCP_AUTH_POPUP_CHANNEL, type McpAuthPopupMessage } from '../../hooks/useMcpAuth.js';

const BROADCAST_RETRY_DELAY_MS = 1000;
const WINDOW_CLOSE_DELAY_MS = 2000;

const PostMcpOauthScreen = () => {
  const [result, setResult] = useState<McpAuthPopupMessage | null>();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const popupUid = searchParams.get('pUid');
    const isSuccess = searchParams.get('isSuccess')?.toLowerCase() === 'true';
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
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        {result === undefined ? (
          <LoaderCircle className="size-16 animate-spin text-muted-foreground" aria-hidden />
        ) : isSuccess ? (
          <CheckCircle2 className="size-16 text-green-600" aria-hidden />
        ) : (
          <XCircle className="size-16 text-destructive" aria-hidden />
        )}
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </main>
  );
};

export default PostMcpOauthScreen;
