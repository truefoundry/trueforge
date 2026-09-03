'use client';

import { cn } from '../lib/cn.js';
import { Switch } from '../primitives/Switch.js';
import type { AgentCapabilityValues } from './agentCapabilities.js';

const CAPABILITIES: Array<{
  id: keyof AgentCapabilityValues;
  label: string;
  description: string;
}> = [
  {
    id: 'generativeUi',
    label: 'Generative UI',
    description: 'Let the agent render interactive UI in its replies.',
  },
  {
    id: 'dynamicSubAgents',
    label: 'Dynamic sub-agents',
    description: 'Let the agent spin up sub-agents for complex tasks.',
  },
  {
    id: 'askUserQuestions',
    label: 'Ask clarifying questions',
    description: 'Let the agent ask before acting when unsure.',
  },
];

export function DraftCapabilitiesPanel({
  value,
  onChange,
  disabled = false,
  divided = false,
  layout = 'list',
}: {
  value: AgentCapabilityValues;
  onChange: (value: AgentCapabilityValues) => void;
  disabled?: boolean;
  divided?: boolean;
  layout?: 'list' | 'cards';
}) {
  if (layout === 'cards') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        {CAPABILITIES.map(capability => {
          const checked = value[capability.id];
          return (
            <div
              key={capability.id}
              className="border-border flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:flex-1"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-text-primary text-sm font-medium">{capability.label}</p>
                <Switch
                  checked={checked}
                  aria-label={capability.label}
                  disabled={disabled}
                  className="mt-0.5"
                  onCheckedChange={nextChecked => onChange({ ...value, [capability.id]: nextChecked })}
                />
              </div>
              <p className="text-text-secondary text-xs leading-snug">{capability.description}</p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', divided && 'overflow-hidden rounded-xl border border-border')}>
      {CAPABILITIES.map((capability, index) => {
        const checked = value[capability.id];
        return (
          <div
            key={capability.id}
            className={cn('flex items-start gap-3 px-3 py-3', divided && index > 0 && 'border-t border-border')}
          >
            <div className="min-w-0 flex-1">
              <p className="text-text-primary text-sm font-medium">{capability.label}</p>
              <p className="text-text-secondary mt-0.5 text-xs leading-snug">{capability.description}</p>
            </div>
            <Switch
              checked={checked}
              aria-label={capability.label}
              disabled={disabled}
              className="mt-0.5"
              onCheckedChange={nextChecked => onChange({ ...value, [capability.id]: nextChecked })}
            />
          </div>
        );
      })}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftCapabilitiesPanel: typeof DraftCapabilitiesPanel;
  }
}
