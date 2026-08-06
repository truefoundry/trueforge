'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { ConnectorAuth, ConnectorAuthType } from '../../server/types.js';

export type McpAuthType = ConnectorAuthType;

export type AddMcpServerDraft = {
  name: string;
  url: string;
  auth: ConnectorAuth;
};

type AddMcpServerFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (draft: AddMcpServerDraft) => void | Promise<void>;
  busy?: boolean;
};

const AUTH_OPTIONS: Array<{ value: McpAuthType; label: string }> = [
  { value: 'dcr', label: 'OAuth' },
  { value: 'none', label: 'None' },
  { value: 'header', label: 'API Key' },
];

const inputClassName =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40';

const RequiredMark = () => (
  <span className="ml-0.5 text-destructive" aria-hidden>
    *
  </span>
);

const AddMcpServerForm = ({ open, onOpenChange, onAdd, busy = false }: AddMcpServerFormProps) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<McpAuthType>('dcr');
  const [apiKey, setApiKey] = useState('');
  const [headerName, setHeaderName] = useState('');

  const resetForm = () => {
    setName('');
    setUrl('');
    setAuthType('dcr');
    setApiKey('');
    setHeaderName('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const isValid = !!name.trim() && !!url.trim() && (authType !== 'header' || !!apiKey.trim());

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || busy) return;

    const auth: ConnectorAuth =
      authType === 'header'
        ? {
            type: 'header',
            apiKey: apiKey.trim(),
            ...(headerName.trim() ? { headerName: headerName.trim() } : {}),
          }
        : { type: authType };

    try {
      await onAdd({
        name: name.trim(),
        url: url.trim(),
        auth,
      });
      resetForm();
      onOpenChange(false);
    } catch {
      // Parent surfaces error; keep form open.
    }
  };

  return (
    <CenteredModal
      open={open}
      onOpenChange={handleOpenChange}
      title="Add MCP server"
      description="Point at a remote MCP endpoint. It then behaves like any other connector."
      contentSized
      headerIcon={
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
          aria-hidden
        >
          <Icon name="mcp-server" className="size-6" />
        </span>
      }
    >
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" onSubmit={e => void handleSubmit(e)}>
        <div className="space-y-4">
          <div>
            <label htmlFor="mcp-server-name" className="mb-1.5 block text-sm font-medium text-foreground">
              Name
              <RequiredMark />
            </label>
            <input
              id="mcp-server-name"
              type="text"
              required
              value={name}
              onChange={event => {
                setName(event.target.value);
              }}
              placeholder="analytics-postgres-mcp"
              autoFocus
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="mcp-server-url" className="mb-1.5 block text-sm font-medium text-foreground">
              URL
              <RequiredMark />
            </label>
            <input
              id="mcp-server-url"
              type="url"
              required
              value={url}
              onChange={event => {
                setUrl(event.target.value);
              }}
              placeholder="https://mcp.example.com/mcp"
              className={inputClassName}
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-foreground">
              Auth type
              <RequiredMark />
            </legend>
            <div className="flex w-full flex-row rounded-md border border-border bg-muted/30 p-1">
              {AUTH_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-sm text-sm font-medium transition-colors ${
                    authType === option.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <input
                    type="radio"
                    name="mcp-auth-type"
                    value={option.value}
                    checked={authType === option.value}
                    onChange={() => {
                      setAuthType(option.value);
                    }}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {authType === 'dcr' ? (
            <p className="text-sm leading-6 text-muted-foreground">
              You&apos;ll be sent to the provider to authorise this server after adding it.
            </p>
          ) : null}

          {authType === 'header' ? (
            <>
              <div>
                <label htmlFor="mcp-server-api-key" className="mb-1.5 block text-sm font-medium text-foreground">
                  API key
                  <RequiredMark />
                </label>
                <input
                  id="mcp-server-api-key"
                  type="password"
                  required
                  value={apiKey}
                  onChange={event => {
                    setApiKey(event.target.value);
                  }}
                  placeholder="Paste the server token"
                  className={inputClassName}
                />
              </div>

              <div>
                <label htmlFor="mcp-server-header-name" className="mb-1.5 block text-sm font-medium text-foreground">
                  Header name <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="mcp-server-header-name"
                  type="text"
                  value={headerName}
                  onChange={event => {
                    setHeaderName(event.target.value);
                  }}
                  placeholder="Authorization"
                  className={inputClassName}
                />
              </div>
            </>
          ) : null}
        </div>

        <Button type="submit" size="lg" disabled={!isValid || busy} className="mt-6 w-full shrink-0">
          Add
        </Button>
      </form>
    </CenteredModal>
  );
};

export default AddMcpServerForm;
