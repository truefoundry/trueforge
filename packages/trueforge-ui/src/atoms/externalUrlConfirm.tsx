'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { getHostname, isExternalHttpUrl, isTrustedHost, openExternalHttpUrl, trustHost } from './externalUrlTrust.js';
import { cn } from './lib/cn.js';
import { Button } from './primitives/Button.js';
import { Checkbox } from './primitives/Checkbox.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './primitives/Dialog.js';

type PendingExternalUrl = {
  kind: 'link' | 'image';
  url: string;
};

type ExternalUrlConfirmContextValue = {
  requestLinkConfirm: (url: string) => void;
  requestImageConfirm: (url: string) => void;
  isSessionImageHostTrusted: (host: string) => boolean;
};

const ExternalUrlConfirmContext = createContext<ExternalUrlConfirmContextValue | null>(null);

function useExternalUrlConfirm(): ExternalUrlConfirmContextValue {
  const value = useContext(ExternalUrlConfirmContext);
  if (value == null) {
    throw new Error('Markdown external URL confirm requires ExternalUrlConfirmProvider');
  }
  return value;
}

/**
 * True for javascript:/data:/vbscript: hrefs (and unparseable ones). Those skip the
 * external-link confirm path, so we block activation instead of letting the browser run them.
 */
function isDangerousNavigationUrl(url: string): boolean {
  try {
    const protocol = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost').protocol;
    return protocol === 'javascript:' || protocol === 'data:' || protocol === 'vbscript:';
  } catch {
    return true;
  }
}

export function ExternalUrlConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingExternalUrl | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [sessionImageHosts, setSessionImageHosts] = useState(() => new Set<string>());

  const requestLinkConfirm = useCallback((url: string) => {
    setDontAskAgain(false);
    setPending({ kind: 'link', url });
  }, []);

  const requestImageConfirm = useCallback((url: string) => {
    setDontAskAgain(false);
    setPending({ kind: 'image', url });
  }, []);

  const isSessionImageHostTrusted = useCallback(
    (host: string) => sessionImageHosts.has(host.toLowerCase()),
    [sessionImageHosts],
  );

  const close = useCallback(() => {
    setPending(null);
    setDontAskAgain(false);
  }, []);

  const confirm = useCallback(() => {
    if (pending == null) return;
    const host = getHostname(pending.url);
    if (pending.kind === 'link') {
      if (dontAskAgain && host != null) trustHost({ kind: 'links', host });
      openExternalHttpUrl(pending.url);
      close();
      return;
    }
    if (host != null) {
      if (dontAskAgain) trustHost({ kind: 'images', host });
      setSessionImageHosts(prev => {
        const next = new Set(prev);
        next.add(host.toLowerCase());
        return next;
      });
    }
    close();
  }, [close, dontAskAgain, pending]);

  const value = useMemo(
    () => ({
      requestLinkConfirm,
      requestImageConfirm,
      isSessionImageHostTrusted,
    }),
    [isSessionImageHostTrusted, requestImageConfirm, requestLinkConfirm],
  );

  const pendingHost = pending != null ? getHostname(pending.url) : null;
  const title = pending?.kind === 'image' ? 'Show external image' : 'Open external link';
  const description =
    pending?.kind === 'image'
      ? "You're about to load an image from an external site:"
      : "You're leaving this app to visit an external link:";
  const confirmLabel = pending?.kind === 'image' ? 'Show image' : 'Open link';
  const checkboxLabel =
    pendingHost == null
      ? null
      : pending?.kind === 'image'
        ? `Don't ask again for images from ${pendingHost}`
        : `Don't ask again for links to ${pendingHost}`;

  return (
    <ExternalUrlConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={pending != null}
        onOpenChange={open => {
          if (!open) close();
        }}
        aria-label={title}
        className="max-w-md"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <p className="text-sm text-text-secondary">{description}</p>
          </DialogHeader>
          {pending != null ? (
            <div
              className="max-h-24 overflow-auto break-all rounded-md bg-secondary-bg px-3 py-2 font-mono text-sm text-text-primary"
              data-testid="aui-external-url-confirm-url"
            >
              {pending.url}
            </div>
          ) : null}
          {checkboxLabel != null ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={dontAskAgain}
              className="flex items-start gap-2 text-left text-sm text-text-secondary"
              onClick={() => setDontAskAgain(value => !value)}
            >
              <Checkbox checked={dontAskAgain} className="mt-0.5" />
              <span>{checkboxLabel}</span>
            </button>
          ) : null}
        </DialogContent>
        <DialogFooter>
          <Button.Secondary type="button" onClick={close}>
            Cancel
          </Button.Secondary>
          <Button.Primary type="button" onClick={confirm}>
            {confirmLabel}
          </Button.Primary>
        </DialogFooter>
      </Dialog>
    </ExternalUrlConfirmContext.Provider>
  );
}

export function MarkdownExternalLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  const { requestLinkConfirm } = useExternalUrlConfirm();
  const dangerous = href != null && href !== '' && isDangerousNavigationUrl(href);
  const external = href != null && href !== '' && !dangerous && isExternalHttpUrl(href);
  // External destinations never stay in href — middle-click / context-menu bypass onClick.
  // Activation always goes through guardNavigation (trusted hosts skip the dialog there).
  const anchorHref = dangerous ? undefined : external ? '#' : href;

  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (href == null || href === '') return;
    if (isDangerousNavigationUrl(href)) {
      event.preventDefault();
      return;
    }
    if (!isExternalHttpUrl(href)) return;

    event.preventDefault();
    const host = getHostname(href);
    if (host != null && isTrustedHost({ kind: 'links', host })) {
      openExternalHttpUrl(href);
      return;
    }
    requestLinkConfirm(href);
  };

  return (
    <a
      {...props}
      href={anchorHref}
      target={external || dangerous ? '_blank' : props.target}
      rel="noopener noreferrer"
      onClick={guardNavigation}
      onAuxClick={guardNavigation}
    >
      {children}
    </a>
  );
}

export function MarkdownExternalImage({
  src,
  alt,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'img'> & { node?: unknown }) {
  const { requestImageConfirm, isSessionImageHostTrusted } = useExternalUrlConfirm();
  const url = typeof src === 'string' ? src : '';
  const host = url !== '' ? getHostname(url) : null;
  const needsGate = url !== '' && isExternalHttpUrl(url);
  const allowed =
    !needsGate || (host != null && (isTrustedHost({ kind: 'images', host }) || isSessionImageHostTrusted(host)));

  if (!allowed) {
    return (
      <span
        className={cn('my-2 flex max-w-full flex-col gap-2 rounded-md border border-border bg-secondary-bg p-3')}
        data-testid="aui-external-image-placeholder"
      >
        <span className="text-sm text-text-secondary">{alt != null && alt !== '' ? alt : 'External image'}</span>
        <span className="max-h-16 overflow-auto break-all font-mono text-xs text-text-secondary">{url}</span>
        <Button.Secondary
          type="button"
          size="small"
          className="self-start"
          onClick={() => {
            if (url !== '') requestImageConfirm(url);
          }}
        >
          Show image
        </Button.Secondary>
      </span>
    );
  }

  return <img {...props} src={src} alt={alt ?? ''} />;
}
