'use client';

import type { AgentRuntimeConfig } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Switch } from '../primitives/Switch.js';
import { Tooltip } from '../primitives/Tooltip.js';

export type AgentRuntimeConfigFieldsProps = {
  value: AgentRuntimeConfig;
  sandboxAvailable: boolean;
  hasSkills: boolean;
  disabled?: boolean;
  showCapabilities?: boolean;
  layout?: 'compact' | 'detailed';
  onChange: (value: AgentRuntimeConfig) => void;
};

function parseIterationLimit(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && Number.isFinite(parsed) ? Math.max(1, Math.min(1024, parsed)) : null;
}

function parsePositiveInteger(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const NO_SANDBOX_PROVIDER_HINT = 'No sandbox provider yet, add one in Settings → Sandbox';

type RuntimeSwitchField = {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
  update: (enabled: boolean) => AgentRuntimeConfig;
};

export function AgentRuntimeConfigFields({
  value,
  sandboxAvailable,
  hasSkills,
  disabled = false,
  showCapabilities = true,
  layout = 'compact',
  onChange,
}: AgentRuntimeConfigFieldsProps) {
  const capabilityFields: RuntimeSwitchField[] = [
    {
      label: 'Dynamic sub-agents',
      description: 'Allow the agent to delegate complex work to focused sub-agents.',
      checked: value.dynamicSubAgents?.enabled ?? true,
      update: enabled => ({ ...value, dynamicSubAgents: { enabled } }),
    },
    {
      label: 'Generative UI',
      description: 'Allow rich interactive UI blocks in agent responses.',
      checked: value.generativeUi?.enabled ?? true,
      update: enabled => ({ ...value, generativeUi: { enabled } }),
    },
    {
      label: 'Ask user questions',
      description: 'Allow the agent to pause and ask for clarification.',
      checked: value.askUserQuestions?.enabled ?? true,
      update: enabled => ({ ...value, askUserQuestions: { enabled } }),
    },
  ];
  const sandboxEnabled = value.sandbox?.enabled ?? false;
  const compactionEnabled = value.contextManagement?.compaction?.enabled ?? true;
  const sandboxField: RuntimeSwitchField = {
    label: 'Sandbox',
    description: 'Provide an isolated environment for code, files, and skills.',
    checked: sandboxEnabled,
    disabled: !sandboxAvailable || hasSkills,
    disabledTooltip: !sandboxAvailable
      ? NO_SANDBOX_PROVIDER_HINT
      : hasSkills
        ? 'Always on while skills are attached — remove them to turn it off'
        : undefined,
    update: enabled => ({ ...value, sandbox: { ...value.sandbox, enabled } }),
  };
  const fileDownloadsField: RuntimeSwitchField = {
    label: 'File downloads',
    description: 'Allow users to download files produced in the sandbox.',
    checked: value.sandbox?.fileDownloads ?? true,
    disabled: !sandboxAvailable || !sandboxEnabled,
    update: fileDownloads => ({
      ...value,
      sandbox: { ...value.sandbox, fileDownloads },
    }),
  };
  const compactionField: RuntimeSwitchField = {
    label: 'Context compaction',
    description: 'Summarize older turns as the context window fills.',
    checked: compactionEnabled,
    update: enabled => ({
      ...value,
      contextManagement: {
        ...value.contextManagement,
        compaction: { ...value.contextManagement?.compaction, enabled },
        largeToolResponse: value.contextManagement?.largeToolResponse ?? { enabled: true },
      },
    }),
  };
  const largeToolResponseField: RuntimeSwitchField = {
    label: 'Large tool response offloading',
    description: 'Move large tool output to the sandbox and retain a preview.',
    checked: value.contextManagement?.largeToolResponse?.enabled ?? true,
    disabled: !sandboxAvailable,
    disabledTooltip: !sandboxAvailable ? `Offloading needs a sandbox. ${NO_SANDBOX_PROVIDER_HINT}` : undefined,
    update: enabled => ({
      ...value,
      contextManagement: {
        ...value.contextManagement,
        compaction: value.contextManagement?.compaction ?? { enabled: true },
        largeToolResponse: { enabled },
      },
    }),
  };
  const runtimeFields = [sandboxField, fileDownloadsField, compactionField, largeToolResponseField];
  const compactionThreshold = value.contextManagement?.compaction?.trigger?.value ?? 50_000;

  const switchField = ({
    field,
    className,
    wrapperClassName,
  }: {
    field: RuntimeSwitchField;
    className?: string;
    wrapperClassName?: string;
  }) => (
    <Tooltip
      key={field.label}
      content={field.disabledTooltip ?? ''}
      triggerClassName={cn('flex w-full min-w-0', wrapperClassName)}
    >
      <label className={cn('flex w-full', className ?? 'items-center justify-between gap-3 py-1.5')}>
        <span className="min-w-0">
          <span className={cn('text-text-primary text-xs', layout === 'detailed' && 'block font-medium')}>
            {field.label}
          </span>
          {layout === 'detailed' ? (
            <span className="text-text-secondary mt-0.5 block text-xs leading-snug">{field.description}</span>
          ) : null}
        </span>
        <Switch
          checked={field.checked}
          disabled={disabled || field.disabled}
          onCheckedChange={enabled => onChange(field.update(enabled))}
          aria-label={field.label}
        />
      </label>
    </Tooltip>
  );

  if (layout === 'detailed') {
    return (
      <div className="space-y-5">
        {showCapabilities ? (
          <div className="flex gap-3">
            {capabilityFields.map((field, index) =>
              switchField({
                field,
                className: 'items-start justify-between gap-3',
                wrapperClassName: cn('flex-1', index < capabilityFields.length - 1 && 'border-r border-border pr-3'),
              }),
            )}
          </div>
        ) : null}
        <label className="flex items-center justify-between gap-4 border-b border-border py-3">
          <span>
            <span className="text-text-primary block text-sm font-medium">Iteration limit</span>
            <span className="text-text-secondary mt-0.5 block text-xs">
              Maximum agent-loop iterations for one turn.
            </span>
          </span>
          <input
            type="number"
            min={1}
            max={1024}
            disabled={disabled}
            value={value.iterationLimit ?? 100}
            className={auiInputClass('h-8 w-24 disabled:opacity-60')}
            onChange={event => {
              const iterationLimit = parseIterationLimit(event.target.value);
              if (iterationLimit !== null) onChange({ ...value, iterationLimit });
            }}
          />
        </label>
        <div className="divide-y divide-border">
          <section className="py-3">
            {switchField({ field: sandboxField, className: 'items-center justify-between gap-4' })}
            <div className={`mt-3 border-l-2 border-primary-button-bg/50 pl-3 ${sandboxEnabled ? '' : 'opacity-50'}`}>
              {switchField({ field: fileDownloadsField, className: 'items-center justify-between gap-4' })}
            </div>
          </section>
          <section className="py-3">
            {switchField({ field: compactionField, className: 'items-center justify-between gap-4' })}
            <label
              className={`mt-3 flex items-center justify-between gap-4 border-l-2 border-primary-button-bg/50 pl-3 ${
                compactionEnabled ? '' : 'opacity-50'
              }`}
            >
              <span>
                <span className="text-text-primary block text-xs font-medium">Compaction threshold tokens</span>
                <span className="text-text-secondary mt-0.5 block text-xs">
                  Input-token threshold that triggers compaction.
                </span>
              </span>
              <input
                type="number"
                min={1}
                disabled={disabled || !compactionEnabled}
                value={compactionThreshold}
                className={auiInputClass('h-8 w-28 disabled:opacity-60')}
                onChange={event => {
                  const threshold = parsePositiveInteger(event.target.value);
                  if (threshold === null) return;
                  onChange({
                    ...value,
                    contextManagement: {
                      ...value.contextManagement,
                      compaction: {
                        ...value.contextManagement?.compaction,
                        enabled: compactionEnabled,
                        trigger: { type: 'input_tokens', value: threshold },
                      },
                      largeToolResponse: value.contextManagement?.largeToolResponse ?? { enabled: true },
                    },
                  });
                }}
              />
            </label>
          </section>
          {switchField({ field: largeToolResponseField, className: 'items-center justify-between gap-4 py-3' })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-2 block text-xs">
        <span className="text-text-secondary mb-1 block">Iteration limit</span>
        <input
          type="number"
          min={1}
          max={1024}
          disabled={disabled}
          value={value.iterationLimit ?? 100}
          className={auiInputClass('h-8 disabled:opacity-60')}
          onChange={event => {
            const iterationLimit = parseIterationLimit(event.target.value);
            if (iterationLimit !== null) onChange({ ...value, iterationLimit });
          }}
        />
      </label>
      {[...runtimeFields, ...(showCapabilities ? capabilityFields : [])].map(field => switchField({ field }))}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentRuntimeConfigFields: typeof AgentRuntimeConfigFields;
  }
}
