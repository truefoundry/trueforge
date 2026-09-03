'use client';

import type { ReactNode } from 'react';

import type { AgentSpec, ModelParams, ModelSelection } from '../../server/types.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Switch } from '../primitives/Switch.js';

export type AgentModelSettingsContentProps = {
  spec: AgentSpec;
  model?: ModelSelection;
  onChange: (spec: AgentSpec) => void;
};

function finiteNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function AgentModelSettingsContent({ spec, model, onChange }: AgentModelSettingsContentProps) {
  const params = spec.model.params ?? {};
  const replaceParams = (next: ModelParams) => onChange({ ...spec, model: { ...spec.model, params: next } });
  const setParam = <Key extends keyof ModelParams>(key: Key, value: ModelParams[Key]) =>
    replaceParams({ ...params, [key]: value });
  const removeParam = (key: keyof ModelParams) => replaceParams({ ...params, [key]: undefined });
  const maxOutputTokens = model?.properties.maxOutputTokens;
  const reasoningEfforts = model?.properties.reasoningEfforts ?? [];
  const firstReasoningEffort = reasoningEfforts[0];

  const rows: Array<{
    label: string;
    enabled: boolean;
    control: ReactNode;
    onToggle: (enabled: boolean) => void;
  }> = [];

  if (maxOutputTokens !== undefined) {
    rows.push({
      label: 'Maximum Tokens',
      enabled: params.maxTokens !== undefined,
      onToggle: enabled => (enabled ? setParam('maxTokens', maxOutputTokens) : removeParam('maxTokens')),
      control: (
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={maxOutputTokens}
            value={params.maxTokens ?? maxOutputTokens}
            disabled={params.maxTokens === undefined}
            aria-label="Maximum tokens slider"
            className="min-w-0 flex-1 accent-primary-button-bg"
            onChange={event => {
              const value = finiteNumber(event.target.value);
              if (value !== null) setParam('maxTokens', value);
            }}
          />
          <input
            type="number"
            min={1}
            max={maxOutputTokens}
            value={params.maxTokens ?? maxOutputTokens}
            disabled={params.maxTokens === undefined}
            aria-label="Maximum tokens value"
            className={auiInputClass('h-8 w-24')}
            onChange={event => {
              const value = finiteNumber(event.target.value);
              if (value !== null) setParam('maxTokens', Math.max(1, Math.min(maxOutputTokens, value)));
            }}
          />
        </div>
      ),
    });
  }

  if (firstReasoningEffort !== undefined) {
    rows.push({
      label: 'Reasoning Effort',
      enabled: params.reasoningEffort !== undefined,
      onToggle: enabled =>
        enabled ? setParam('reasoningEffort', firstReasoningEffort) : removeParam('reasoningEffort'),
      control: (
        <select
          value={params.reasoningEffort ?? ''}
          disabled={params.reasoningEffort === undefined}
          aria-label="Reasoning effort value"
          className={auiInputClass('mt-2 h-9 cursor-pointer py-1.5')}
          onChange={event => setParam('reasoningEffort', event.target.value)}
        >
          {reasoningEfforts.map(effort => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      ),
    });
  }

  return (
    <div className="w-full p-5">
      {rows.length > 0 ? (
        <div className="divide-y divide-border">
          {rows.map(row => (
            <div key={row.label} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-primary text-sm font-medium">{row.label}</span>
                <Switch checked={row.enabled} onCheckedChange={row.onToggle} aria-label={`Enable ${row.label}`} />
              </div>
              {row.control}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-text-secondary text-sm">No configurable parameters are available for this model.</p>
      )}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentModelSettingsContent: typeof AgentModelSettingsContent;
  }
}
