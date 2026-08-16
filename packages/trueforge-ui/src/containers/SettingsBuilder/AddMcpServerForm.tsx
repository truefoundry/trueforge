'use client';

import { useState, type FormEvent } from 'react';

import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { ConnectorAuth, ConnectorAuthType } from '../../server/types.js';

export type McpAuthType = ConnectorAuthType;

export type AddMcpServerDraft = {
  name: string;
  url: string;
  description: string;
  auth: ConnectorAuth;
};

type AddMcpServerFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (draft: AddMcpServerDraft) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
};

const AUTH_OPTIONS: Array<{ value: McpAuthType; label: string }> = [
  { value: 'dcr', label: 'OAuth' },
  { value: 'none', label: 'None' },
  { value: 'header', label: 'API Key' },
];

const inputClassName = auiInputClass('h-11 shadow-sm');

const RequiredMark = () => (
  <span className="ml-0.5 text-failure-bg" aria-hidden>
    *
  </span>
);

const AddMcpServerForm = ({ open, onOpenChange, onAdd, busy = false, error }: AddMcpServerFormProps) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [authType, setAuthType] = useState<McpAuthType>('dcr');
  const [apiKey, setApiKey] = useState('');
  const [headerName, setHeaderName] = useState('');

  const resetForm = () => {
    setName('');
    setUrl('');
    setDescription('');
    setAuthType('dcr');
    setApiKey('');
    setHeaderName('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const isValid = !!name.trim() && !!description.trim() && !!url.trim() && (authType !== 'header' || !!apiKey.trim());

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
        description: description.trim(),
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
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
          aria-hidden
        >
          <Icon name="mcp-server" className="size-6" />
        </span>
      }
    >
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" onSubmit={e => void handleSubmit(e)}>
        <div className="space-y-4">
          <div>
            <label htmlFor="mcp-server-name" className="mb-1.5 block text-sm font-medium text-text-primary">
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
            <label htmlFor="mcp-server-description" className="mb-1.5 block text-sm font-medium text-text-primary">
              Description
              <RequiredMark />
            </label>
            <textarea
              id="mcp-server-description"
              value={description}
              onChange={event => {
                setDescription(event.target.value);
              }}
              placeholder="Query analytics from Postgres"
              required
              rows={3}
              className={auiInputClass('resize-y py-2.5 shadow-sm')}
            />
          </div>

          <div>
            <label htmlFor="mcp-server-url" className="mb-1.5 block text-sm font-medium text-text-primary">
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
            <legend className="mb-1.5 text-sm font-medium text-text-primary">
              Auth type
              <RequiredMark />
            </legend>
            <div className="flex w-full flex-row rounded-md border border-border bg-secondary-bg/40 p-1">
              {AUTH_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-sm text-sm font-medium transition-colors ${
                    authType === option.value
                      ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
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
            <div className="flex gap-1.5 bg-secondary-bg/40 p-2 rounded-md">
              <Icon name="info" className="size-3.5 mt-1 text-text-secondary" />
              <div className="text-xs text-text-secondary leading-5.5">
                Sign-in only — the server must support dynamic client registration. Manual OAuth (client ID / secret)
                isn't supported yet.
              </div>
            </div>
          ) : null}

          {authType === 'header' ? (
            <>
              <div>
                <label htmlFor="mcp-server-api-key" className="mb-1.5 block text-sm font-medium text-text-primary">
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
                <label htmlFor="mcp-server-header-name" className="mb-1.5 block text-sm font-medium text-text-primary">
                  Header name <span className="font-normal text-text-secondary">(optional)</span>
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

        <div className="mt-6 space-y-3">
          {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
          <Button type="submit" size="lg" disabled={!isValid || busy} className="w-full shrink-0">
            Add
          </Button>
        </div>
      </form>
    </CenteredModal>
  );
};

export default AddMcpServerForm;
