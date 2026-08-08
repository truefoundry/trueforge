'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { ModelSelection } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { hasReasoningEfforts, modelPatchWithReasoningEffort, resolveReasoningEffort } from './reasoningEffort.js';

type RichModel = ModelSelection & { apiModel?: string; modelId?: string };

function modelValue(model: RichModel): string {
  return model.apiModel ?? model.name;
}

export type DraftReasoningEffortSelectorProps = {
  disabled?: boolean;
  isRunning?: boolean;
};

export function DraftReasoningEffortSelector({ disabled, isRunning }: DraftReasoningEffortSelectorProps) {
  const { models: rawModels, ensureLoaded } = useDraftCatalog();
  const models = rawModels as RichModel[];
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const clearedStickyEffortForModelRef = useRef<string | null>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const compactLayout = useCompactLayout();

  const selectedName = agentSpec?.model?.name ?? (models[0] ? modelValue(models[0]) : '');
  const selected = models.find(m => modelValue(m) === selectedName || m.name === selectedName);
  const efforts = selected?.reasoningEfforts;
  const currentEffort = agentSpec?.model?.params?.reasoningEffort;
  // Display fallback only — coerce into the spec on model change / explicit pick.
  const resolved = resolveReasoningEffort(efforts, currentEffort);

  useEffect(() => {
    // Need catalog to know whether this model exposes reasoning efforts.
    ensureLoaded();
  }, [ensureLoaded]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Heal sticky effort left by mergeAgentSpec when the selected model has none.
  useEffect(() => {
    if (!updateAgentSpec || selected === undefined) return;
    if (hasReasoningEfforts(efforts)) {
      clearedStickyEffortForModelRef.current = null;
      return;
    }
    if (currentEffort === undefined) return;
    const modelKey = modelValue(selected);
    if (clearedStickyEffortForModelRef.current === modelKey) return;
    clearedStickyEffortForModelRef.current = modelKey;
    updateAgentSpec({
      model: modelPatchWithReasoningEffort(modelKey, agentSpec?.model?.params, undefined),
    });
  }, [updateAgentSpec, selected, efforts, currentEffort, agentSpec?.model?.params]);

  if (!hasReasoningEfforts(efforts) || !resolved) return null;

  const content = (
    <>
      <div className="border-b border-border px-3 py-2">
        <p className="text-foreground text-sm font-semibold">Reasoning effort</p>
      </div>
      <div
        id={menuId}
        role="listbox"
        aria-label="Select reasoning effort"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
      >
        {efforts.map(effort => {
          const active = effort === resolved;
          return (
            <button
              key={effort}
              type="button"
              role="option"
              aria-selected={active}
              className={cn(
                'flex w-full items-center rounded-md px-2 py-2 text-left text-sm',
                active ? 'bg-accent' : 'hover:bg-accent/60',
              )}
              onClick={() => {
                if (!selected || !updateAgentSpec) return;
                updateAgentSpec({
                  model: modelPatchWithReasoningEffort(
                    modelValue(selected),
                    { ...agentSpec?.model?.params, reasoningEffort: effort },
                    efforts,
                  ),
                });
                setOpen(false);
              }}
            >
              <span className="truncate font-medium">{effort}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || isRunning}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Select reasoning effort"
        className={auiButtonClass({
          variant: 'ghost',
          size: 'sm',
          className: cn('h-8 max-w-[10rem] gap-1.5 rounded-full px-2 text-xs font-medium', 'hover:bg-accent'),
        })}
        onClick={() => setOpen(v => !v)}
      >
        <span className="truncate">{resolved}</span>
        <Icon name="chevron-down" className="size-3.5 shrink-0 opacity-60" />
      </button>

      {open ? (
        isMobile || compactLayout ? (
          <BottomSheet open onOpenChange={setOpen} aria-label="Select reasoning effort">
            {content}
          </BottomSheet>
        ) : (
          <div className="bg-popover text-popover-foreground absolute right-0 bottom-full z-50 mb-2 flex max-h-[22rem] w-[12rem] flex-col overflow-hidden rounded-lg border border-border shadow-lg">
            {content}
          </div>
        )
      ) : null}
    </div>
  );
}
