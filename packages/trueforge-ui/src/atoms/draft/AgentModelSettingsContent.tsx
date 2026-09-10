'use client';

import { useRef, useState, type ReactNode } from 'react';

import type { AgentSpec, ModelParams, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';

export type AgentModelSettingsContentProps = {
  spec: AgentSpec;
  model?: ModelSelection;
  onChange: (spec: AgentSpec) => void;
};

enum ParamsView {
  UI = 'ui',
  JSON = 'json',
}

const CONTROLLED_PARAM_KEYS = new Set(['maxTokens', 'reasoningEffort']);

function finiteNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModelParams(value: unknown): value is ModelParams {
  if (!isRecord(value)) return false;
  const maxTokens = value['maxTokens'];
  const reasoningEffort = value['reasoningEffort'];
  return (
    (maxTokens === undefined || (typeof maxTokens === 'number' && Number.isFinite(maxTokens))) &&
    (reasoningEffort === undefined || typeof reasoningEffort === 'string')
  );
}

function customParamsFrom(params: ModelParams): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([key, value]) => !CONTROLLED_PARAM_KEYS.has(key) && value !== undefined),
  );
}

function formatParams(params: ModelParams): string {
  return JSON.stringify(params, null, 2);
}

export function AgentModelSettingsContent({ spec, model, onChange }: AgentModelSettingsContentProps) {
  const CodeEditor = useSlot('CodeEditor');
  const AgentCustomParametersEditor = useSlot('AgentCustomParametersEditor');

  const params = spec.model.params ?? {};
  const [view, setView] = useState<ParamsView>(ParamsView.UI);
  const [jsonValue, setJsonValue] = useState(() => formatParams(params));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [customEnabled, setCustomEnabled] = useState(() => Object.keys(customParamsFrom(params)).length > 0);

  const savedCustomParams = useRef<Record<string, unknown> | null>(null);
  const replaceParams = (next: ModelParams) => onChange({ ...spec, model: { ...spec.model, params: next } });
  const setParam = <Key extends keyof ModelParams>(key: Key, value: ModelParams[Key]) =>
    replaceParams({ ...params, [key]: value });
  const removeParam = (key: keyof ModelParams) => replaceParams({ ...params, [key]: undefined });

  const replaceCustomParams = (custom: Record<string, unknown>) => {
    const clearedCustom = Object.fromEntries(Object.keys(customParamsFrom(params)).map(key => [key, undefined]));
    replaceParams({ ...params, ...clearedCustom, ...custom });
  };

  const replaceAllParams = (next: ModelParams) => {
    const cleared = Object.fromEntries(
      Object.keys(params)
        .filter(key => !Object.hasOwn(next, key))
        .map(key => [key, undefined]),
    );
    replaceParams({ ...cleared, ...next });
  };

  const setParamsView = (nextView: ParamsView) => {
    setView(nextView);
    setJsonError(null);
    if (nextView === ParamsView.JSON) setJsonValue(formatParams(params));
  };

  const handleJsonChange = (value: string | undefined) => {
    if (value === undefined) return;
    setJsonValue(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isModelParams(parsed)) {
        setJsonError('Parameters must be a JSON object with valid model parameter values.');
        return;
      }
      setJsonError(null);
      setCustomEnabled(Object.keys(customParamsFrom(parsed)).length > 0);
      replaceAllParams(parsed);
    } catch {
      setJsonError('Invalid JSON.');
    }
  };

  const toggleCustomParams = () => {
    const nextEnabled = !customEnabled;
    setCustomEnabled(nextEnabled);
    if (nextEnabled) {
      const restored = savedCustomParams.current ?? {};
      replaceCustomParams(restored);
      return;
    }
    savedCustomParams.current = customParamsFrom(params);
    replaceCustomParams({});
  };

  const maxOutputTokens = model?.properties.maxOutputTokens;
  const reasoningEfforts = model?.properties.reasoningEfforts ?? [];
  const firstReasoningEffort = reasoningEfforts[0];

  const rows: Array<{
    label: string;
    enabled: boolean;
    control: ReactNode;
    onToggle: (enabled: boolean) => void;
  }> = [];

  if (firstReasoningEffort !== undefined) {
    rows.push({
      label: 'Reasoning Effort',
      enabled: params.reasoningEffort !== undefined,
      onToggle: enabled =>
        enabled ? setParam('reasoningEffort', firstReasoningEffort) : removeParam('reasoningEffort'),
      control: (
        <select
          value={params.reasoningEffort ?? ''}
          aria-label="Reasoning effort value"
          className={auiInputClass('h-8 cursor-pointer py-1.5')}
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

  if (maxOutputTokens !== undefined) {
    rows.push({
      label: 'Maximum Tokens',
      enabled: params.maxTokens !== undefined,
      onToggle: enabled => (enabled ? setParam('maxTokens', maxOutputTokens) : removeParam('maxTokens')),
      control: (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={maxOutputTokens}
            value={params.maxTokens ?? maxOutputTokens}
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

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-text-primary text-sm font-semibold">Parameters</h3>
        <div className="bg-secondary-button-bg flex rounded-md border border-input-border p-0.5">
          {Object.values(ParamsView).map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              className={cn(
                'min-w-10 rounded px-2 py-1 text-xs font-medium transition-colors',
                view === value
                  ? 'bg-primary-button-bg text-primary-button-text'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              onClick={() => setParamsView(value)}
            >
              {value === ParamsView.UI ? 'UI' : 'JSON'}
            </button>
          ))}
        </div>
      </div>

      {view === ParamsView.UI ? (
        <div className="max-h-[min(30rem,calc(100dvh-8rem))] overflow-y-auto px-4">
          <div className="divide-y divide-border">
            {rows.map(row => (
              <div key={row.label} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-primary text-sm font-medium">{row.label}</span>
                  <button
                    type="button"
                    aria-label={`Turn ${row.label} ${row.enabled ? 'off' : 'on'}`}
                    aria-pressed={row.enabled}
                    className={auiButtonClass({ variant: 'ghost', size: 'small' })}
                    onClick={() => row.onToggle(!row.enabled)}
                  >
                    {row.enabled ? 'On' : 'Off'}
                  </button>
                </div>
                {row.enabled ? <div className="mt-2">{row.control}</div> : null}
              </div>
            ))}

            <div className="py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-primary text-sm font-medium">Custom Parameters</span>
                <button
                  type="button"
                  aria-label={`Turn Custom Parameters ${customEnabled ? 'off' : 'on'}`}
                  aria-pressed={customEnabled}
                  className={auiButtonClass({ variant: 'ghost', size: 'small' })}
                  onClick={toggleCustomParams}
                >
                  {customEnabled ? 'On' : 'Off'}
                </button>
              </div>

              {customEnabled ? (
                <div className="mt-3 mb-2">
                  <AgentCustomParametersEditor
                    value={customParamsFrom(params)}
                    reservedKeys={CONTROLLED_PARAM_KEYS}
                    onChange={replaceCustomParams}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-88 p-4">
          <CodeEditor
            value={jsonValue}
            language="json"
            height="20rem"
            showToolbar={false}
            className={cn('h-80', jsonError && 'border-failure-bg')}
            onChange={handleJsonChange}
          />
          {jsonError ? <p className="text-failure-bg mt-2 text-sm font-medium">{jsonError}</p> : null}
        </div>
      )}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentModelSettingsContent: typeof AgentModelSettingsContent;
  }
}
