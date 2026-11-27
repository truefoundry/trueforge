'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { ConnectorCatalogEntry } from '../../server/types.js';

type ConnectorApiKeyDialogProps = {
  /** The header-auth connector awaiting a key; `null` keeps the dialog closed. */
  entry: ConnectorCatalogEntry | null;
  busy: boolean;
  error: string | null;
  onSubmit: (apiKey: string) => void;
  onCancel: () => void;
};

/** Collects the API key / token for a header-auth catalog connector before it is created. */
export function ConnectorApiKeyDialog({ entry, busy, error, onSubmit, onCancel }: ConnectorApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState('');

  // A new entry must never inherit the key typed for the previous one.
  useEffect(() => {
    setApiKey('');
  }, [entry]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    onSubmit(apiKey.trim());
  };

  return (
    <CenteredModal
      open={entry !== null}
      onOpenChange={open => {
        if (!open) onCancel();
      }}
      title={`Connect ${entry?.name ?? 'connector'}`}
      description={entry?.url}
      contentSized
      className="md:max-w-xl"
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-5 px-5 py-5">
          <div className="flex items-center gap-3">
            <span
              className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary-bg"
              aria-hidden
            >
              <Icon name="mcp-server" className="size-6 text-text-primary" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-text-primary">{entry?.name}</p>
              <p className="truncate text-sm text-text-secondary">{entry?.description}</p>
            </div>
          </div>

          <div>
            <label
              htmlFor="connector-api-key"
              className="mb-2 block text-xs font-semibold uppercase tracking-wide text-text-secondary"
            >
              API key / token
            </label>
            <input
              id="connector-api-key"
              type="password"
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
              }}
              placeholder={`Bearer <Paste the token from ${entry?.name ?? 'the provider'}>`}
              autoFocus
              required
              className={auiInputClass('h-11')}
            />
          </div>
          {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button.Ghost type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button.Ghost>
          <Button.Primary type="submit" disabled={!apiKey.trim() || busy}>
            Connect
          </Button.Primary>
        </footer>
      </form>
    </CenteredModal>
  );
}
