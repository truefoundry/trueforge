'use client';

import type { ReactNode } from 'react';

import { useMCPAuth } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';
import type { ConnectorState } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Button } from '../primitives/Button.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';
import { Checkbox } from '../primitives/Checkbox.js';
import { Tooltip } from '../primitives/Tooltip.js';

export function SectionHeading({ label, count }: { label: string; count?: number }) {
  return (
    <div className="text-text-secondary px-3 pt-2 pb-1 text-[0.6875rem] font-medium tracking-wide uppercase">
      {count == null ? label : `${label} (${count})`}
    </div>
  );
}

/** What a row in this panel cannot do, kept readable while the row itself is dimmed. */
export function RowNote({ children, icon = 'lock' }: { children: string; icon?: 'lock' | 'info' }) {
  return (
    <div
      role="status"
      className="border-primary-button-bg/30 bg-primary-button-bg/5 text-text-primary mx-3 mb-2 flex items-start gap-2 rounded-lg border p-3"
    >
      <Icon name={icon} className="text-primary-button-bg mt-px size-3 shrink-0" />
      <span className="text-xs leading-snug">{children}</span>
    </div>
  );
}

export function CatalogSearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative mx-3 my-2 block">
      <Icon
        name="search"
        className="text-text-secondary pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
      />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={auiInputClass('h-8 bg-secondary-bg py-1 pr-2 pl-7 dark:bg-primary-bg')}
      />
    </label>
  );
}

export function CatalogRow({
  title,
  description,
  badge,
  logo,
  fallbackIcon,
  checked,
  disabled = false,
  disabledReason,
  selectionControl = 'checkbox',
  onToggle,
  onActivate,
  action,
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  /** Catalog logo URL; when absent, `fallbackIcon` (or the title initial) is shown. */
  logo?: string | undefined;
  fallbackIcon?: string;
  checked: boolean;
  disabled?: boolean;
  /** Shown on hover when `disabled` — e.g. host capability unavailable. */
  disabledReason?: string;
  selectionControl?: 'checkbox' | 'radio';
  onToggle: () => void;
  onActivate?: () => void;
  action?: ReactNode;
}) {
  const content = (
    <>
      <span
        className="bg-secondary-bg text-text-secondary mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border text-xs font-semibold"
        aria-hidden
      >
        {logo ? (
          <CatalogLogo src={logo} alt={title} className="size-4" />
        ) : fallbackIcon ? (
          <Icon name={fallbackIcon} className="text-text-primary size-4" />
        ) : (
          title.charAt(0).toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-text-primary truncate text-sm font-medium">{title}</span>
          {badge}
        </span>
        {description ? (
          <Tooltip
            content={description}
            side="bottom"
            className="max-w-sm whitespace-normal text-left"
            triggerClassName="block min-w-0 w-full"
            interactive={false}
          >
            <span className="text-text-secondary block truncate text-xs">{description}</span>
          </Tooltip>
        ) : null}
      </span>
    </>
  );

  const control =
    selectionControl === 'radio' ? (
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
          checked ? 'border-primary-button-bg bg-primary-button-bg' : 'border-text-secondary/60 bg-input-box-bg',
        )}
        aria-hidden
      >
        {checked ? <span className="size-1.5 rounded-full bg-primary-button-text" /> : null}
      </span>
    ) : (
      <Checkbox checked={checked} />
    );

  const role = selectionControl === 'radio' ? 'menuitemradio' : 'menuitemcheckbox';
  const controlButton = (
    <button
      type="button"
      role={selectionControl === 'radio' ? 'radio' : 'checkbox'}
      aria-checked={checked}
      aria-label={`${checked ? 'Deselect' : 'Select'} ${title}`}
      disabled={disabled}
      className="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={event => {
        event.stopPropagation();
        if (disabled) return;
        onToggle();
      }}
    >
      {control}
    </button>
  );
  // Tooltip only on the control — row hover must not surface the disabled reason.
  const selectionControlNode =
    disabled && disabledReason ? (
      <Tooltip content={disabledReason} className="max-w-xs text-left">
        <span className="inline-flex shrink-0">{controlButton}</span>
      </Tooltip>
    ) : (
      controlButton
    );

  if (action || onActivate || disabled) {
    return (
      <div
        role={role}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          'hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left',
          disabled && 'cursor-default opacity-50 hover:bg-transparent',
        )}
        onClick={() => {
          if (disabled) return;
          (onActivate ?? onToggle)();
        }}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (disabled) return;
          (onActivate ?? onToggle)();
        }}
      >
        {content}
        {action ? (
          <span
            className="shrink-0"
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
          >
            {action}
          </span>
        ) : null}
        {selectionControlNode}
      </div>
    );
  }

  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      className="hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left"
      onClick={onToggle}
    >
      {content}
      {control}
    </button>
  );
}

export function isUnauthenticatedDcrConnector(connector: ConnectorState): boolean {
  const auth = Reflect.get(connector, 'auth');
  return (
    connector.authenticated === false &&
    typeof auth === 'object' &&
    auth !== null &&
    Reflect.get(auth, 'type') === 'dcr'
  );
}

export function ConnectorConnectButton({
  connector,
  onConnected,
}: {
  connector: ConnectorState;
  onConnected: () => Promise<void>;
}) {
  const { handleAuthorize, isOAuthLoading } = useMCPAuth();

  return (
    <Button.Secondary
      type="button"
      aria-label={`Connect ${connector.name}`}
      disabled={isOAuthLoading}
      size="small"
      onKeyDown={event => {
        event.stopPropagation();
      }}
      onClick={event => {
        event.stopPropagation();
        void handleAuthorize(connector.id, isSuccess => {
          if (isSuccess) void onConnected();
        });
      }}
    >
      {isOAuthLoading ? 'Connecting...' : 'Connect'}
    </Button.Secondary>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    CatalogRow: typeof CatalogRow;
    ConnectorConnectButton: typeof ConnectorConnectButton;
  }
}
