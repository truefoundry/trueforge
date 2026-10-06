import { useCallback, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';

export type MessageErrorBannerProps = {
  message: string;
  /** Raw technical text behind `message`, revealed on demand. */
  detail?: string;
  /** Machine-readable code, shown alongside the detail so a report can name the failure. */
  code?: string;
  className?: string;
};

export function MessageErrorBanner({ message, detail, code, className }: MessageErrorBannerProps) {
  const [copied, setCopied] = useState(false);
  const hasDetail = detail != null && detail.trim() !== '' && detail.trim() !== message.trim();

  const copyDetail = useCallback(() => {
    const text = code == null ? (detail ?? message) : `[${code}] ${detail ?? message}`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [code, detail, message]);

  return (
    <div
      role="alert"
      className={cn(
        'aui-message-error-root border-failure-bg bg-failure-bg/10 text-failure-bg mt-2 flex flex-col gap-2 rounded-md border p-3 text-sm',
        className,
      )}
    >
      <span className="aui-message-error-message">{message}</span>

      {hasDetail ? (
        <details className="aui-message-error-details">
          <summary className="cursor-pointer select-none text-xs opacity-80 hover:opacity-100">Show details</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/5 p-2 text-xs">
            {code == null ? detail : `[${code}] ${detail}`}
          </pre>
        </details>
      ) : null}

      {hasDetail ? (
        <button
          type="button"
          onClick={copyDetail}
          className="flex w-fit cursor-pointer items-center gap-1 text-xs opacity-80 hover:opacity-100"
        >
          <Icon name={copied ? 'check' : 'copy'} size="0.75rem" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      ) : null}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageErrorBanner: typeof MessageErrorBanner;
  }
}
