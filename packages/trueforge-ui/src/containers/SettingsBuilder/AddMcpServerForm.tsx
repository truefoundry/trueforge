'use client';

import { useState, type FormEvent } from 'react';

import { cn } from '../../atoms/lib/cn.js';
import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { ConnectorAuth, ConnectorAuthType } from '../../server/types.js';
import {
  RequiredMark,
  SETTINGS_INPUT_ERROR_CLASS_NAME,
  SettingsFieldError,
  useTouchedFields,
} from './SettingsFormField.js';
import {
  validateHttpHeaderName,
  validateHttpUrl,
  validateRequired,
  validateResourceName,
} from './settingsFormValidation.js';

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
  existingNames?: readonly string[];
};

const AUTH_OPTIONS: Array<{ value: McpAuthType; label: string }> = [
  { value: 'dcr', label: 'OAuth' },
  { value: 'none', label: 'None' },
  { value: 'header', label: 'API Key' },
];

const inputClassName = auiInputClass('h-11 shadow-sm');

type AddMcpServerField = 'name' | 'description' | 'url' | 'apiKey' | 'headerName';
const ADD_MCP_SERVER_FIELDS: readonly AddMcpServerField[] = ['name', 'description', 'url', 'apiKey', 'headerName'];

const AddMcpServerForm = ({
  open,
  onOpenChange,
  onAdd,
  busy = false,
  error,
  existingNames = [],
}: AddMcpServerFormProps) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [authType, setAuthType] = useState<McpAuthType>('dcr');
  const [apiKey, setApiKey] = useState('');
  const [headerName, setHeaderName] = useState('');
  const { isTouched, resetTouched, touch, touchAll } = useTouchedFields<AddMcpServerField>();

  const resetForm = () => {
    setName('');
    setUrl('');
    setDescription('');
    setAuthType('dcr');
    setApiKey('');
    setHeaderName('');
    resetTouched();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const nameError = validateResourceName({ value: name, label: 'Connector name', existingNames });
  const descriptionError = validateRequired({ value: description, label: 'Description' });
  const urlError = validateHttpUrl({ value: url, label: 'URL' });
  const apiKeyError = authType === 'header' ? validateRequired({ value: apiKey, label: 'API key' }) : null;
  const headerNameError = authType === 'header' ? validateHttpHeaderName(headerName) : null;
  const isValid = !nameError && !descriptionError && !urlError && !apiKeyError && !headerNameError;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    touchAll(ADD_MCP_SERVER_FIELDS);
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
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" noValidate onSubmit={e => void handleSubmit(e)}>
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
              onBlur={() => touch('name')}
              placeholder="analytics-postgres-mcp"
              autoFocus
              aria-invalid={isTouched('name') && nameError ? true : undefined}
              aria-describedby={isTouched('name') && nameError ? 'mcp-server-name-error' : undefined}
              className={cn(inputClassName, isTouched('name') && nameError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
            />
            {isTouched('name') && nameError ? (
              <SettingsFieldError id="mcp-server-name-error">{nameError}</SettingsFieldError>
            ) : null}
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
              onBlur={() => touch('description')}
              placeholder="Query analytics from Postgres"
              required
              rows={3}
              aria-invalid={isTouched('description') && descriptionError ? true : undefined}
              aria-describedby={
                isTouched('description') && descriptionError ? 'mcp-server-description-error' : undefined
              }
              className={cn(
                auiInputClass('resize-y py-2.5 shadow-sm'),
                isTouched('description') && descriptionError && SETTINGS_INPUT_ERROR_CLASS_NAME,
              )}
            />
            {isTouched('description') && descriptionError ? (
              <SettingsFieldError id="mcp-server-description-error">{descriptionError}</SettingsFieldError>
            ) : null}
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
              onBlur={() => touch('url')}
              placeholder="https://mcp.example.com/mcp"
              aria-invalid={isTouched('url') && urlError ? true : undefined}
              aria-describedby={isTouched('url') && urlError ? 'mcp-server-url-error' : undefined}
              className={cn(inputClassName, isTouched('url') && urlError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
            />
            {isTouched('url') && urlError ? (
              <SettingsFieldError id="mcp-server-url-error">{urlError}</SettingsFieldError>
            ) : null}
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
                  onBlur={() => touch('apiKey')}
                  placeholder="Paste the server token"
                  aria-invalid={isTouched('apiKey') && apiKeyError ? true : undefined}
                  aria-describedby={isTouched('apiKey') && apiKeyError ? 'mcp-server-api-key-error' : undefined}
                  className={cn(inputClassName, isTouched('apiKey') && apiKeyError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
                />
                {isTouched('apiKey') && apiKeyError ? (
                  <SettingsFieldError id="mcp-server-api-key-error">{apiKeyError}</SettingsFieldError>
                ) : null}
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
                  onBlur={() => touch('headerName')}
                  placeholder="Authorization"
                  aria-invalid={isTouched('headerName') && headerNameError ? true : undefined}
                  aria-describedby={
                    isTouched('headerName') && headerNameError ? 'mcp-server-header-name-error' : undefined
                  }
                  className={cn(
                    inputClassName,
                    isTouched('headerName') && headerNameError && SETTINGS_INPUT_ERROR_CLASS_NAME,
                  )}
                />
                {isTouched('headerName') && headerNameError ? (
                  <SettingsFieldError id="mcp-server-header-name-error">{headerNameError}</SettingsFieldError>
                ) : null}
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
