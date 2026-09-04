'use client';

import { useId, type ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { AgentSpec, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Tooltip } from '../primitives/Tooltip.js';
import type { AgentConfigEditor } from './AgentConfigEditors.js';
import {
  editableMountsFromSpec,
  enabledToolsFromMount,
  preloadFromMount,
  withPreload,
  type EditableMount,
} from './agentConfigMounts.js';
import { displayModelLabel, ProviderMark } from './DraftModelCatalogPanel.js';
import { modelParamSummary } from './modelParamsSummary.js';
import { runtimeConfigSummary } from './runtimeConfigSummary.js';

export type AgentConfigPanelProps = {
  spec: AgentSpec;
  model?: ModelSelection;
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

function McpServerChip({
  item,
  onRemove,
  onTogglePreload,
}: {
  item: EditableMount;
  onRemove?: () => void;
  onTogglePreload?: () => void;
}) {
  const enabled = enabledToolsFromMount(item.value);
  const preload = preloadFromMount(item.value);
  const toolsLabel = enabled === 'all' ? 'All tools' : `${enabled.length} tools`;

  return (
    <span className="flex items-center overflow-hidden rounded-md border border-border text-xs">
      {onTogglePreload ? (
        <Tooltip
          side="bottom"
          dismissOnClick={false}
          triggerClassName="self-stretch"
          className="w-64 whitespace-normal p-3 text-left shadow-lg"
          content={
            <span className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold">Preload tools</span>
                <span className="text-primary-button-bg text-[10px] font-semibold tracking-wide uppercase">
                  {preload ? 'ON' : 'OFF'}
                </span>
              </span>
              <span className="text-text-secondary text-xs leading-snug">
                Load MCP tool definitions in the agent context upfront. When off, the agent discovers tools dynamically
                (uses less context upfront).
              </span>
            </span>
          }
        >
          <button
            type="button"
            aria-pressed={preload}
            aria-label={`Preload tools for ${item.name}`}
            className={cn(
              'flex h-full items-center justify-center border-r border-border px-1.5 transition-colors',
              preload
                ? 'bg-primary-button-bg text-primary-button-text'
                : 'text-text-secondary hover:bg-ghost-button-hover',
            )}
            onClick={onTogglePreload}
          >
            <Icon name="book-open" className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}
      <span className="py-1 pl-2">{item.name}</span>
      <span className="text-text-secondary ml-1 py-1">{toolsLabel}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${item.name}`}
          className={auiButtonClass({
            variant: 'ghost',
            size: 'icon',
            className: 'mx-1 size-5',
          })}
          onClick={onRemove}
        >
          <Icon name="xmark" className="size-3" />
        </button>
      ) : (
        <span className="pr-2" />
      )}
    </span>
  );
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
      <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-border bg-topbar-bg px-2 py-1.5">
        <Icon name="sliders" className="size-4" />
        <h2 className="text-sm font-semibold">Agent Config</h2>
        <span className="min-w-0 flex-1" />
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

        <section className="group border-b border-border px-4 py-4">
          <div className={cn('flex items-center justify-between gap-3', mcp.length ? 'mb-3' : null)}>
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="mcp-server" className="text-text-secondary size-4 shrink-0" />
              <h3 className="text-text-primary text-sm font-semibold">MCP Servers</h3>
            </div>
            <button
              type="button"
              aria-label="Add MCP server"
              className={auiButtonClass({
                variant: 'ghost',
                size: 'icon',
                className: 'size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
              })}
              onClick={() => onOpenEditor('mcp')}
            >
              <Icon name="plus" className="size-3.5" />
            </button>
          </div>
          {mcp.length ? (
            <div className="flex flex-wrap gap-1.5">
              {mcp.map(item => (
                <McpServerChip
                  key={item.id}
                  item={item}
                  onRemove={
                    onChange
                      ? () =>
                          onChange({
                            ...spec,
                            mcpServers: mcp.filter(mount => mount.id !== item.id).map(mount => mount.value),
                          })
                      : undefined
                  }
                  onTogglePreload={
                    onChange
                      ? () =>
                          onChange({
                            ...spec,
                            mcpServers: mcp.map(mount =>
                              mount.id === item.id
                                ? withPreload(mount.value, !preloadFromMount(mount.value))
                                : mount.value,
                            ),
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          ) : null}
        </section>

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
