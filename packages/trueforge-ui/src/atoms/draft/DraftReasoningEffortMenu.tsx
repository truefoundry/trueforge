'use client';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { reasoningEffortLabel } from './reasoningEffort.js';

export function DraftReasoningEffortMenu({
  efforts,
  current,
  onSelect,
  onBack,
}: {
  efforts: string[];
  /** `undefined` is the "Default" option: no effort is sent. */
  current: string | undefined;
  onSelect: (effort: string | undefined) => void;
  /** Set when the menu replaces the model list (bottom sheet) instead of opening beside it. */
  onBack: (() => void) | undefined;
}) {
  const options = [undefined, ...efforts];
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-2">
        {onBack ? (
          <button
            type="button"
            aria-label="Back to models"
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: '-ml-1 size-7 shrink-0' })}
            onClick={onBack}
          >
            <Icon name="arrow-left" className="size-4" />
          </button>
        ) : null}
        <p className="text-text-secondary text-sm font-normal">Reasoning</p>
      </div>
      <div aria-hidden className="mx-3 shrink-0 border-t border-border" />
      <div role="menu" aria-label="Reasoning effort" className="flex min-h-0 flex-col overflow-y-auto p-1">
        {options.map(effort => {
          const active = effort === current;
          return (
            <button
              key={effort ?? ''}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm',
                active ? 'bg-primary-button-bg/10 text-primary-button-bg' : 'hover:bg-ghost-button-hover',
              )}
              onClick={() => onSelect(effort)}
            >
              <span className="truncate font-normal">{reasoningEffortLabel(effort)}</span>
              {active ? <Icon name="check" className="ml-auto size-3.5 shrink-0" /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
