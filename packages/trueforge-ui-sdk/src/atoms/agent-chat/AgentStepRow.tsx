import type { ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { Spinner } from '../primitives/Spinner.js';
import { StatusDot } from './StatusDot.js';
import { StepIconBox } from './StepIconBox.js';

export type AgentStepStatus = 'idle' | 'running' | 'success' | 'error';

export type AgentStepRowProps = {
  icon: string;
  iconVariant?: 'primary' | 'muted';
  iconClassName?: string;
  iconSize?: string | number;
  title?: ReactNode;
  label?: string;
  body?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  status?: AgentStepStatus;
  statusText?: string;
  showSpinner?: boolean;
  showConnector?: boolean;
  showContentConnector?: boolean;
  showPersistentContentConnector?: boolean;
  showChevronColumn?: boolean;
  children?: ReactNode;
  persistentChildren?: ReactNode;
  dataTestPrefix?: string;
  className?: string;
  titleClassName?: string;
  align?: 'center' | 'start';
};

export function AgentStepRow({
  icon,
  iconVariant = 'primary',
  iconClassName,
  iconSize,
  title,
  label,
  body,
  expandable = false,
  expanded = false,
  onToggle,
  status = 'idle',
  statusText,
  showSpinner = false,
  showConnector = false,
  showContentConnector = true,
  showPersistentContentConnector = true,
  showChevronColumn = true,
  children,
  persistentChildren,
  dataTestPrefix,
  className,
  titleClassName,
  align = 'center',
}: AgentStepRowProps) {
  const hasChildren = !!children;
  const hasPersistentChildren = !!persistentChildren;
  const showExpandChevron = expandable && onToggle != null;
  const isRunning = status === 'running';
  const isSuccess = status === 'success';
  const isError = status === 'error';
  const alignStart = align === 'start';

  return (
    <div
      className={cn('flex min-w-0 flex-col', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-step-row` : undefined}
    >
      <div className={cn('flex gap-2', alignStart ? 'items-start' : 'items-center')}>
        {showChevronColumn &&
          (showExpandChevron ? (
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse step' : 'Expand step'}
              data-testid={dataTestPrefix ? `${dataTestPrefix}-chevron` : undefined}
            >
              <Icon
                name="chevron-right"
                size="0.625rem"
                className={cn(
                  'shrink-0 text-text-secondary transition-transform duration-300',
                  expanded && 'rotate-90',
                )}
              />
            </button>
          ) : (
            <div className="w-5 shrink-0" />
          ))}

        <div className={cn('relative flex shrink-0 flex-col items-center', alignStart ? 'self-start' : 'self-center')}>
          <StepIconBox icon={icon} variant={iconVariant} iconClassName={iconClassName} iconSize={iconSize} />
        </div>

        <div
          className={cn('flex min-w-0 flex-1 flex-col justify-center', {
            'cursor-pointer': showExpandChevron,
          })}
          onClick={showExpandChevron ? onToggle : undefined}
        >
          {label && <span className="text-xs font-medium leading-none text-text-secondary">{label}</span>}
          {title && (
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'min-w-0 truncate font-sans text-[0.75rem] font-medium leading-5 text-text-primary',
                  titleClassName,
                )}
                data-testid={dataTestPrefix ? `${dataTestPrefix}-title` : undefined}
              >
                {title}
              </span>
              {isSuccess && (
                <Icon
                  name="circle-check"
                  size="0.875rem"
                  className="shrink-0 text-success-bg"
                  data-testid={dataTestPrefix ? `${dataTestPrefix}-success-icon` : undefined}
                />
              )}
            </div>
          )}
          {body && (
            <div
              className="mt-1 font-sans text-sm text-text-secondary"
              onClick={e => {
                if (expanded && showExpandChevron) e.stopPropagation();
              }}
              data-testid={dataTestPrefix ? `${dataTestPrefix}-body` : undefined}
            >
              {body}
            </div>
          )}
        </div>

        <div className={cn('flex shrink-0 items-center gap-2', alignStart ? 'self-start' : 'self-center')}>
          {statusText && (
            <span className="flex items-center gap-1">
              {isRunning && <StatusDot />}
              <span className="font-sans text-xs font-medium leading-4 text-text-secondary">{statusText}</span>
            </span>
          )}
          {!statusText && isRunning && (
            <>
              {showSpinner ? (
                <div className="ml-1">
                  <Spinner size={12} />
                </div>
              ) : (
                <StatusDot />
              )}
            </>
          )}
          {isError && (
            <Icon
              name="circle-xmark"
              size="0.875rem"
              className="text-failure-bg"
              data-testid={dataTestPrefix ? `${dataTestPrefix}-error-icon` : undefined}
            />
          )}
        </div>
      </div>

      {expanded && hasChildren && (
        <div
          className="mt-2 flex min-w-0 gap-3"
          data-testid={dataTestPrefix ? `${dataTestPrefix}-expanded-content` : undefined}
        >
          {showChevronColumn && <div className="w-5 shrink-0" />}
          {showContentConnector && showConnector && (
            <div className="flex w-3 shrink-0 justify-center">
              <div className="w-px bg-border" />
            </div>
          )}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      )}

      {hasPersistentChildren && (
        <div
          className={cn('flex min-w-0', showPersistentContentConnector ? 'gap-3' : 'gap-2')}
          data-testid={dataTestPrefix ? `${dataTestPrefix}-persistent-content` : undefined}
        >
          {showChevronColumn && <div className="w-5 shrink-0" />}
          {showPersistentContentConnector && showConnector && (
            <div className="flex w-3 shrink-0 justify-center">
              <div className="w-px bg-border" />
            </div>
          )}
          <div className="min-w-0 flex-1">{persistentChildren}</div>
        </div>
      )}
    </div>
  );
}
