'use client';

import { useId, type ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { AgentSpec, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { auiInputClass } from '../lib/inputClasses.js';
import type { AgentConfigEditor } from './AgentConfigEditors.js';
import { editableMountsFromSpec, enabledToolsFromMount } from './agentConfigMounts.js';
import { displayModelLabel, ProviderMark } from './DraftModelCatalogPanel.js';
import { modelParamSummary } from './modelParamsSummary.js';
import { runtimeConfigSummary } from './runtimeConfigSummary.js';

export type AgentConfigPanelProps = {
  spec: AgentSpec;
  model?: ModelSelection;
  saveAction?: ReactNode;
  skillsAvailable: boolean;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  onInstructionsBlur: () => void;
  onOpenEditor: (editor: AgentConfigEditor) => void;
  onChange?: (spec: AgentSpec) => void;
  onClose?: () => void;
};

function formatTokens(value: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function AgentConfigSection({
  title,
  description,
  onEdit,
  children,
}: {
  title: string;
  description?: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-text-primary text-sm font-semibold">{title}</h3>
          {description ? <p className="text-text-secondary mt-0.5 text-xs">{description}</p> : null}
        </div>
        {onEdit ? (
          <button
            type="button"
            aria-label={`Edit ${title}`}
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
            onClick={onEdit}
          >
            <Icon name="pencil" className="size-3.5" />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function AgentConfigPanel({
  spec,
  model,
  saveAction,
  skillsAvailable,
  instructions,
  onInstructionsChange,
  onInstructionsBlur,
  onOpenEditor,
  onChange,
  onClose,
}: AgentConfigPanelProps) {
  const instructionsId = useId();
  const Section = useSlot('AgentConfigSection');
  const mcp = editableMountsFromSpec(spec.mcpServers);
  const skills = editableMountsFromSpec(spec.skills);
  const modelParams = modelParamSummary(spec.model.params);
  const runtimeConfig = runtimeConfigSummary(spec.config);
  const modelInfo = [
    model?.properties.contextLength === undefined ? null : formatTokens(model.properties.contextLength),
  ].filter((value): value is string => value !== null);
  const modelInfoTitle = [
    model?.properties.contextLength === undefined
      ? null
      : `Context: ${model.properties.contextLength.toLocaleString()} tokens`,
    model?.properties.maxOutputTokens === undefined
      ? null
      : `Maximum output: ${model.properties.maxOutputTokens.toLocaleString()} tokens`,
  ]
    .filter((value): value is string => value !== null)
    .join('\n');

  return (
    <div className="bg-card-bg text-text-primary flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Icon name="sliders" className="size-4" />
        <h2 className="text-sm font-semibold">Agent Config</h2>
        <span className="min-w-0 flex-1" />
        {saveAction}
        {onClose ? (
          <button
            type="button"
            aria-label="Close agent config"
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-8' })}
            onClick={onClose}
          >
            <Icon name="xmark" />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Model">
          <div className="flex items-center gap-2">
            <ProviderMark
              logo={model?.provider.logo}
              label={model?.provider.name ?? spec.model.name}
              className="size-4 text-[8px]"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{displayModelLabel(spec.model.name)}</span>
            {modelInfo.length ? (
              <span title={modelInfoTitle} className="text-text-secondary shrink-0 whitespace-nowrap text-[11px]">
                {modelInfo.join(' · ')}
              </span>
            ) : null}
            <button
              type="button"
              aria-label="Edit Model"
              title="Edit Model"
              className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
              onClick={() => onOpenEditor('model')}
            >
              <Icon name="pencil" className="size-3.5" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <dl className="text-text-secondary flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-xs">
              {modelParams.length ? (
                modelParams.map(entry => (
                  <div key={entry.label} className="flex gap-1">
                    <dt>{entry.label}:</dt>
                    <dd className="text-text-primary font-medium">{entry.value}</dd>
                  </div>
                ))
              ) : (
                <div>model settings: defaults</div>
              )}
            </dl>
            <button
              type="button"
              aria-label="Model settings"
              title="Model settings"
              className={auiButtonClass({
                variant: 'ghost',
                size: 'icon',
                className: 'size-7 shrink-0 self-start',
              })}
              onClick={() => onOpenEditor('model-settings')}
            >
              <Icon name="sliders" className="size-3.5" />
            </button>
          </div>
        </Section>

        <Section title="Instructions" description="Define the agent's role, goals, and behavior.">
          <label htmlFor={instructionsId} className="sr-only">
            Agent instructions
          </label>
          <textarea
            id={instructionsId}
            value={instructions}
            rows={5}
            placeholder="Enter detailed instructions for your agent…"
            className={auiInputClass('resize-y py-2')}
            onChange={event => onInstructionsChange(event.target.value)}
            onBlur={onInstructionsBlur}
          />
        </Section>

        <Section
          title="Runtime Config"
          description="Control execution and context behavior."
          onEdit={() => onOpenEditor('runtime')}
        >
          <dl className="text-text-secondary flex flex-wrap gap-x-3 gap-y-1 text-xs leading-relaxed">
            {runtimeConfig.map(entry => (
              <div key={entry.label} className="flex gap-1">
                <dt>{entry.label}:</dt>
                <dd className="text-text-primary font-medium">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="MCP Servers" onEdit={() => onOpenEditor('mcp')}>
          {mcp.length ? (
            <div className="flex flex-wrap gap-1.5">
              {mcp.map(item => {
                const enabled = enabledToolsFromMount(item.value);
                return (
                  <span
                    key={item.id}
                    className="flex items-center rounded-md border border-border py-1 pr-1 pl-2 text-xs"
                  >
                    <span>{item.name}</span>
                    <span className="text-text-secondary ml-1">
                      {enabled === 'all' ? 'All tools' : `${enabled.length} tools`}
                    </span>
                    {onChange ? (
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        className={auiButtonClass({
                          variant: 'ghost',
                          size: 'icon',
                          className: 'ml-1 size-5',
                        })}
                        onClick={() =>
                          onChange({
                            ...spec,
                            mcpServers: mcp.filter(mount => mount.id !== item.id).map(mount => mount.value),
                          })
                        }
                      >
                        <Icon name="xmark" className="size-3" />
                      </button>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-text-secondary text-xs">No MCP servers selected.</p>
          )}
        </Section>

        <Section title="Skills" onEdit={() => onOpenEditor('skills')}>
          {!skillsAvailable ? (
            <p className="text-text-secondary text-xs">Skills require an available sandbox.</p>
          ) : skills.length ? (
            <div className="flex flex-wrap gap-1.5">
              {skills.map(item => (
                <span key={item.id} className="rounded-md border border-border px-2 py-1 text-xs">
                  {item.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-text-secondary text-xs">No skills selected.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentConfigPanel: typeof AgentConfigPanel;
    AgentConfigSection: typeof AgentConfigSection;
  }
}
