'use client';

import { useState } from 'react';

import { Icon } from '../icons/Icon.js';
import type { AgentLibraryEntry } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { cn } from './lib/cn.js';
import { DropdownMenu, DropdownMenuItem } from './primitives/DropdownMenu.js';
import { DropdownSubmenu } from './primitives/DropdownSubmenu.js';

export type ComposerAssistantAgentsPickerSelection =
  { kind: 'assistant' } | { kind: 'agent'; agentId: string; agentName: string };

export type ComposerAssistantAgentsPickerProps = {
  selection: ComposerAssistantAgentsPickerSelection;
  disabled?: boolean;
  onSelectAssistant: () => void;
  onSelectAgent: (agent: AgentLibraryEntry) => void;
  className?: string;
};

function selectionLabel(selection: ComposerAssistantAgentsPickerSelection): string {
  return selection.kind === 'assistant' ? 'Assistant' : selection.agentName;
}

function selectionIcon(selection: ComposerAssistantAgentsPickerSelection): 'message-square-text' | 'agent-2' {
  return selection.kind === 'assistant' ? 'message-square-text' : 'agent-2';
}

/**
 * Presentational Assistant / Agents menu that sits above the New Chat composer.
 * Containers supply selection + shell callbacks; this atom owns only open UI state.
 */
export function ComposerAssistantAgentsPicker({
  selection,
  disabled = false,
  onSelectAssistant,
  onSelectAgent,
  className,
}: ComposerAssistantAgentsPickerProps) {
  const AgentSearchListPanel = useSlot('AgentSearchListPanel');
  const [open, setOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const label = selectionLabel(selection);
  const icon = selectionIcon(selection);
  const assistantSelected = selection.kind === 'assistant';
  const selectedAgentId = selection.kind === 'agent' ? selection.agentId : undefined;

  return (
    <div className={cn('flex w-full min-w-0 items-center', className)}>
      <DropdownMenu
        align="start"
        open={open}
        onOpenChange={next => {
          if (disabled) return;
          setOpen(next);
          if (!next) setAgentsOpen(false);
        }}
        closeOnClick={false}
        className="min-w-[11rem]"
        trigger={
          <button
            type="button"
            disabled={disabled}
            aria-label={`Chat mode: ${label}`}
            className={cn(
              'text-text-primary inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm',
              'hover:bg-ghost-button-hover',
              'focus-visible:ring-focus-ring/40 focus-visible:ring-2 focus-visible:outline-none',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <Icon name={icon} className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
            <Icon name="chevron-down" className="text-text-secondary size-3.5 shrink-0" />
          </button>
        }
      >
        <DropdownMenuItem
          aria-checked={assistantSelected}
          className="text-text-primary"
          onClick={() => {
            onSelectAssistant();
            setOpen(false);
            setAgentsOpen(false);
          }}
        >
          <Icon name="message-square-text" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Assistant</span>
          <Icon
            name="check"
            className={cn(
              'text-primary-button-hover ml-auto size-3.5 shrink-0',
              assistantSelected ? 'opacity-100' : 'opacity-0',
            )}
          />
        </DropdownMenuItem>

        <DropdownSubmenu
          open={agentsOpen}
          onOpenChange={setAgentsOpen}
          trigger={
            <DropdownMenuItem
              className="text-text-primary aria-expanded:bg-ghost-button-hover"
              aria-expanded={agentsOpen}
              onClick={event => {
                // Keep parent menu open; hover/keyboard opens the Agents panel.
                event.preventDefault();
                setAgentsOpen(true);
              }}
            >
              <Icon name="agent-2" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">Agents</span>
              <Icon name="chevron-right" className="text-text-secondary ml-auto size-3.5 shrink-0" />
            </DropdownMenuItem>
          }
        >
          <AgentSearchListPanel
            enabled={open && agentsOpen && !disabled}
            selectedAgentId={selectedAgentId}
            onPick={agent => {
              onSelectAgent(agent);
              setAgentsOpen(false);
              setOpen(false);
            }}
          />
        </DropdownSubmenu>
      </DropdownMenu>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ComposerAssistantAgentsPicker: typeof ComposerAssistantAgentsPicker;
  }
}
