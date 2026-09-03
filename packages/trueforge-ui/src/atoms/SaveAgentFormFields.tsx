'use client';

import { Icon } from '../icons/Icon.js';
import type { AgentSpec, ModelSelection } from '../server/types.js';
import type { AgentConfigEditor } from './draft/AgentConfigEditors.js';
import { enabledToolsFromMount, type EditableMount } from './draft/agentConfigMounts.js';
import { displayModelLabel, ProviderMark } from './draft/DraftModelCatalogPanel.js';
import { modelParamSummary } from './draft/modelParamsSummary.js';
import { runtimeConfigSummary } from './draft/runtimeConfigSummary.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { Tooltip } from './primitives/Tooltip.js';

export type SaveAgentFormFieldsProps = {
  spec: AgentSpec;
  modelEntry?: ModelSelection;
  mcpMounts: EditableMount[];
  skillMounts: EditableMount[];
  disabled: boolean;
  onEdit: (editor: AgentConfigEditor) => void;
  onToggleMcpPreload: (id: string) => void;
  onRemoveMcp?: (id: string) => void;
};

const PRELOAD_TOOLS_COPY = {
  header: 'Preload tools',
  on: 'Tool definitions load into context upfront. No discovery step, but uses more context.',
  off: 'The agent discovers tools on demand. Lighter context upfront, but a discovery step the first time it needs a tool.',
} as const;

function formatTokens(value: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function SaveAgentFormFields({
  spec,
  modelEntry,
  mcpMounts,
  skillMounts,
  disabled,
  onEdit,
  onToggleMcpPreload,
  onRemoveMcp,
}: SaveAgentFormFieldsProps) {
  const contextLength = Reflect.get(modelEntry?.properties ?? {}, 'contextLength');
  const maxOutputTokens = Reflect.get(modelEntry?.properties ?? {}, 'maxOutputTokens');
  const modelParams = modelParamSummary(spec.model.params);
  const runtimeConfig = runtimeConfigSummary(spec.config);

  return (
    <>
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-text-secondary text-xs font-semibold tracking-wide uppercase">Model</span>
          <button
            type="button"
            aria-label="Edit Model"
            disabled={disabled}
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
            onClick={() => onEdit('model')}
          >
            <Icon name="pencil" className="size-3.5" />
          </button>
        </div>
        {spec.model.name ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="border-border inline-flex items-center gap-2 rounded-lg border py-1 pr-2.5 pl-2">
              <ProviderMark
                logo={modelEntry?.provider.logo}
                label={modelEntry?.provider.name ?? spec.model.name}
                className="size-4 text-[8px]"
              />
              <span className="text-text-primary text-sm">{displayModelLabel(spec.model.name)}</span>
            </span>
            {typeof contextLength === 'number' && contextLength ? (
              <span className="text-text-secondary text-xs">{formatTokens(contextLength)} context</span>
            ) : null}
            {typeof maxOutputTokens === 'number' && maxOutputTokens ? (
              <span className="text-text-secondary text-xs">{formatTokens(maxOutputTokens)} max output</span>
            ) : null}
          </div>
        ) : (
          <p className="text-text-secondary text-xs">No model selected.</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <dl className=" text-text-secondary flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-xs">
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
            disabled={disabled}
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7 shrink-0' })}
            onClick={() => onEdit('model-settings')}
          >
            <Icon name="sliders" className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-text-secondary text-xs font-semibold tracking-wide uppercase">Runtime Config</span>
          <button
            type="button"
            aria-label="Edit Runtime Config"
            disabled={disabled}
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
            onClick={() => onEdit('runtime')}
          >
            <Icon name="pencil" className="size-3.5" />
          </button>
        </div>
        <dl className="text-text-secondary flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {runtimeConfig.map(entry => (
            <div key={entry.label} className="flex gap-1">
              <dt>{entry.label}:</dt>
              <dd className="text-text-primary font-medium">{entry.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-text-secondary text-xs font-semibold tracking-wide uppercase">Connectors</span>
          <button
            type="button"
            aria-label="Edit Connectors"
            disabled={disabled}
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
            onClick={() => onEdit('mcp')}
          >
            <Icon name="pencil" className="size-3.5" />
          </button>
        </div>
        {mcpMounts.length === 0 ? (
          <p className="text-text-secondary text-xs">No connectors added.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mcpMounts.map(mount => {
              const preload = Reflect.get(mount.value, 'preload') === true;
              const enabledTools = enabledToolsFromMount(mount.value);
              const label = `${PRELOAD_TOOLS_COPY.header} · ${preload ? 'ON' : 'OFF'}`;
              return (
                <span
                  key={mount.id}
                  className="border-border flex items-center gap-2 rounded-lg border py-1 pr-2.5 pl-1.5"
                >
                  <Tooltip
                    className="max-w-68 whitespace-normal"
                    content={
                      <div className="text-left">
                        <p className="mb-1 text-[11px] font-semibold tracking-wide uppercase">{label}</p>
                        <p className="text-xs leading-snug">
                          {preload ? PRELOAD_TOOLS_COPY.on : PRELOAD_TOOLS_COPY.off}
                        </p>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={preload}
                      disabled={disabled}
                      onClick={() => onToggleMcpPreload(mount.id)}
                      className={cn(
                        'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border',
                        'transition-[color,background-color,border-color,transform] active:scale-90',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40',
                        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
                        preload
                          ? 'border-primary-button-bg/40 bg-primary-button-bg/10 text-primary-button-bg hover:border-primary-button-bg/70 hover:bg-primary-button-bg/20'
                          : 'border-border text-text-secondary hover:border-text-secondary/50 hover:bg-text-secondary/10 hover:text-text-primary',
                      )}
                    >
                      <Icon name="book-open" className="size-3.5" />
                    </button>
                  </Tooltip>
                  <span className="text-text-primary text-sm">{mount.name}</span>
                  <span className="text-text-secondary text-xs">
                    {enabledTools === 'all' ? 'All tools' : `${enabledTools.length} tools`}
                  </span>
                  {onRemoveMcp ? (
                    <button
                      type="button"
                      aria-label={`Remove ${mount.name}`}
                      disabled={disabled}
                      className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-5' })}
                      onClick={() => onRemoveMcp(mount.id)}
                    >
                      <Icon name="xmark" className="size-3" />
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-text-secondary text-xs font-semibold tracking-wide uppercase">Skills</span>
          <button
            type="button"
            aria-label="Edit Skills"
            disabled={disabled}
            className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
            onClick={() => onEdit('skills')}
          >
            <Icon name="pencil" className="size-3.5" />
          </button>
        </div>
        {skillMounts.length === 0 ? (
          <p className="text-text-secondary text-xs">No skills added.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {skillMounts.map(mount => (
              <span
                key={mount.id}
                className="border-border flex items-center gap-2 rounded-lg border py-1 pr-2.5 pl-2.5"
              >
                <span className="text-text-primary text-sm">{mount.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SaveAgentFormFields: typeof SaveAgentFormFields;
  }
}
