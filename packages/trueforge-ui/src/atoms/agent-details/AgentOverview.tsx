'use client';

import { useState, type ComponentType } from 'react';
import { Icon } from '../../icons/Icon.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { cn } from '../lib/cn.js';
import type { AgentOverviewProps } from './types.js';

type InstructionsView = 'markdown' | 'raw';

const valueClassName = 'text-right font-mono text-primary-button-bg';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function readName(value: object): string | null {
  if (!('name' in value) || typeof value.name !== 'string') return null;
  return value.name;
}

function readRecordValue(record: Record<string, unknown> | null, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function hasAllTools(value: object): boolean {
  if (!isRecord(value)) return false;
  const tools = readRecordValue(value, 'enableTools', 'enable_tools');
  return tools === undefined || (Array.isArray(tools) && tools.includes('@all'));
}

function displayModelName(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

export default function AgentOverview({ detail }: AgentOverviewProps) {
  const Markdown = useSlot('Markdown');
  const AgentOverviewCard = useSlot('AgentOverviewCard');
  const [instructionsView, setInstructionsView] = useState<InstructionsView>('markdown');
  const [copied, setCopied] = useState(false);
  const spec = detail.agentSpec;
  const skills = spec.skills ?? [];
  const connectors = spec.mcpServers ?? [];
  const modelParams = isRecord(spec.model.params) ? spec.model.params : null;
  const maxTokens = readRecordValue(modelParams, 'maxTokens', 'max_tokens');
  const temperature = readRecordValue(modelParams, 'temperature');
  const config = isRecord(spec.config) ? spec.config : null;
  const sandbox = isRecord(config?.sandbox) ? config.sandbox : null;
  const instructions = spec.instructions?.trim() ? spec.instructions : null;
  const execution = [
    ['Sandbox', typeof sandbox?.enabled === 'boolean' ? (sandbox.enabled ? 'Enabled' : 'Disabled') : undefined],
    ['Iteration limit', readRecordValue(config, 'iterationLimit', 'iteration_limit')],
    ['Response format', readRecordValue(config, 'responseFormat', 'response_format')],
  ].filter((entry): entry is [string, string | number] => {
    return typeof entry[1] === 'string' || typeof entry[1] === 'number';
  });
  const capabilities = [
    ['Generative UI', spec.config?.generativeUi?.enabled],
    ['Dynamic sub-agents', spec.config?.dynamicSubAgents?.enabled],
    ['Ask user questions', spec.config?.askUserQuestions?.enabled],
  ].filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean');
  const toggleLabel = instructionsView === 'markdown' ? 'Raw' : 'Markdown';

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-4 md:grid-cols-[minmax(0,1fr)_18rem] md:overflow-hidden">
      <section className="flex min-h-64 flex-col rounded-lg border border-border bg-card-bg p-4 text-text-primary">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
            <Icon name="book-open" className="size-4 text-text-secondary" />
            Instructions
          </h2>
          {instructions ? (
            <div
              className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-border bg-primary-bg text-xs font-medium text-text-secondary"
              role="group"
              aria-label="Instructions actions"
            >
              <button
                type="button"
                aria-label={`Show ${toggleLabel}`}
                onClick={() => setInstructionsView(view => (view === 'markdown' ? 'raw' : 'markdown'))}
                className="cursor-pointer px-2.5 transition-colors hover:bg-ghost-button-hover hover:text-text-primary"
              >
                {toggleLabel}
              </button>
              <span className="w-px self-stretch bg-border" aria-hidden />
              <button
                type="button"
                title={copied ? 'Copied!' : 'Copy'}
                aria-label={copied ? 'Copied!' : 'Copy'}
                onClick={() => {
                  void navigator.clipboard.writeText(instructions).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                className="inline-flex cursor-pointer items-center justify-center px-2 transition-colors hover:bg-ghost-button-hover hover:text-text-primary"
              >
                <Icon name={copied ? 'check' : 'copy'} size={12} />
              </button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {instructions ? (
            instructionsView === 'markdown' ? (
              <Markdown content={instructions} readOnly className="text-sm" />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-sm text-text-primary">{instructions}</pre>
            )
          ) : (
            <p className="text-sm text-text-secondary">No instructions for this agent.</p>
          )}
        </div>
      </section>

      <aside className="flex min-h-0 min-w-0 flex-col gap-3 md:overflow-auto">
        <AgentOverviewCard title="Model Configuration" icon="cpu">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-text-secondary">Model</dt>
            <dd className={cn(valueClassName, 'truncate')} title={spec.model.name}>
              {displayModelName(spec.model.name)}
            </dd>
            {typeof maxTokens === 'number' ? (
              <>
                <dt className="text-text-secondary">Max tokens</dt>
                <dd className={valueClassName}>{maxTokens}</dd>
              </>
            ) : null}
            {spec.model.params?.reasoningEffort !== undefined ? (
              <>
                <dt className="text-text-secondary">Reasoning</dt>
                <dd className={valueClassName}>{spec.model.params.reasoningEffort}</dd>
              </>
            ) : null}
            {typeof temperature === 'number' ? (
              <>
                <dt className="text-text-secondary">Temperature</dt>
                <dd className={valueClassName}>{temperature}</dd>
              </>
            ) : null}
          </dl>
        </AgentOverviewCard>
        <AgentOverviewCard title="MCP Servers" icon="plug" count={connectors.length}>
          {connectors.length === 0 ? (
            <p className="text-xs text-text-secondary">No connectors attached.</p>
          ) : (
            <ul className="space-y-1.5">
              {connectors.map((connector, index) => (
                <li
                  key={`${readName(connector) ?? 'connector'}-${index}`}
                  className="rounded-md bg-secondary-bg px-2 py-1.5 text-xs"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{readName(connector) ?? `Connector ${index + 1}`}</span>
                    {hasAllTools(connector) ? (
                      <span className="shrink-0 rounded-full bg-primary-button-bg/10 px-1.5 py-0.5 text-[10px] text-primary-button-bg">
                        All tools
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AgentOverviewCard>

        <AgentOverviewCard title="Attached Skills" icon="lightbulb" count={skills.length}>
          {skills.length === 0 ? (
            <p className="text-xs text-text-secondary">No skills attached.</p>
          ) : (
            <ul className="space-y-1.5">
              {skills.map((skill, index) => (
                <li
                  key={`${readName(skill) ?? 'skill'}-${index}`}
                  className="rounded-md bg-secondary-bg px-2 py-1.5 text-xs"
                >
                  {readName(skill) ?? `Skill ${index + 1}`}
                </li>
              ))}
            </ul>
          )}
        </AgentOverviewCard>

        {execution.length > 0 ? (
          <AgentOverviewCard title="Execution" icon="terminal">
            <dl className="space-y-1 text-xs">
              {execution.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className={valueClassName}>{value}</dd>
                </div>
              ))}
            </dl>
          </AgentOverviewCard>
        ) : null}

        {capabilities.length > 0 ? (
          <AgentOverviewCard title="Capabilities" icon="cube">
            <dl className="space-y-1 text-xs">
              {capabilities.map(([label, enabled]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className={valueClassName}>{enabled ? 'Enabled' : 'Disabled'}</dd>
                </div>
              ))}
            </dl>
          </AgentOverviewCard>
        ) : null}
      </aside>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentOverview: ComponentType<AgentOverviewProps>;
  }
}
