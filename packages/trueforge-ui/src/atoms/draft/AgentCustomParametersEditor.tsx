'use client';

import { useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { cn } from '../lib/cn.js';
import { DropdownMenu, DropdownMenuItem } from '../primitives/DropdownMenu.js';

type CustomParameterType = 'string' | 'number' | 'json';

type CustomParameterDraft = {
  id: string;
  key: string;
  type: CustomParameterType;
  value: string;
};

export type AgentCustomParametersEditorProps = {
  value: Record<string, unknown>;
  reservedKeys: ReadonlySet<string>;
  onChange: (value: Record<string, unknown>) => void;
};

function customParameterType(value: unknown): CustomParameterType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'json';
}

function customParameterValue(value: unknown, type: CustomParameterType): string {
  if (type === 'string') return typeof value === 'string' ? value : '';
  if (type === 'number') return typeof value === 'number' ? String(value) : '';
  return JSON.stringify(value, null, 2) ?? 'null';
}

function emptyCustomDraft(id: string): CustomParameterDraft {
  return { id, key: '', type: 'string', value: '' };
}

function customDraftsFrom(value: Record<string, unknown>): CustomParameterDraft[] {
  return Object.entries(value).map(([key, entryValue], index) => {
    const type = customParameterType(entryValue);
    return {
      id: `existing-${index}-${key}`,
      key,
      type,
      value: customParameterValue(entryValue, type),
    };
  });
}

function initialCustomDrafts(value: Record<string, unknown>): CustomParameterDraft[] {
  const drafts = customDraftsFrom(value);
  return drafts.length > 0 ? drafts : [emptyCustomDraft('new-0')];
}

function parseCustomValue(
  draft: CustomParameterDraft,
): { valid: true; value: unknown } | { valid: false; error: string } {
  if (draft.type === 'string') return { valid: true, value: draft.value };
  if (draft.type === 'number') {
    const value = Number(draft.value);
    return draft.value.trim() === '' || !Number.isFinite(value)
      ? { valid: false, error: 'Enter a valid number.' }
      : { valid: true, value };
  }
  try {
    const value: unknown = JSON.parse(draft.value);
    return { valid: true, value };
  } catch {
    return { valid: false, error: 'Enter valid JSON.' };
  }
}

function customDraftError({
  draft,
  drafts,
  reservedKeys,
}: {
  draft: CustomParameterDraft;
  drafts: CustomParameterDraft[];
  reservedKeys: ReadonlySet<string>;
}): string | null {
  const key = draft.key.trim();
  if (key === '') return 'Enter a parameter name.';
  if (reservedKeys.has(key)) return 'This parameter already has a dedicated control.';
  if (drafts.some(candidate => candidate.id !== draft.id && candidate.key.trim() === key)) {
    return 'Parameter names must be unique.';
  }
  const parsed = parseCustomValue(draft);
  return parsed.valid ? null : parsed.error;
}

function customParameterTypeMark(type: CustomParameterType): string {
  if (type === 'string') return 'Aa';
  if (type === 'number') return '#';
  return '{ }';
}

export function AgentCustomParametersEditor({ value, reservedKeys, onChange }: AgentCustomParametersEditorProps) {
  const CodeEditor = useSlot('CodeEditor');
  const [drafts, setDrafts] = useState(() => initialCustomDrafts(value));
  const nextId = useRef(drafts.length);

  const commitDrafts = (nextDrafts: CustomParameterDraft[]) => {
    if (nextDrafts.some(draft => customDraftError({ draft, drafts: nextDrafts, reservedKeys }) !== null)) {
      return;
    }
    const entries: Array<[string, unknown]> = [];
    nextDrafts.forEach(draft => {
      const parsed = parseCustomValue(draft);
      if (parsed.valid) entries.push([draft.key.trim(), parsed.value]);
    });
    onChange(Object.fromEntries(entries));
  };

  const updateDraft = ({
    id,
    patch,
  }: {
    id: string;
    patch: Partial<Pick<CustomParameterDraft, 'key' | 'type' | 'value'>>;
  }) => {
    const next = drafts.map(draft => (draft.id === id ? { ...draft, ...patch } : draft));
    setDrafts(next);
    commitDrafts(next);
  };

  const removeDraft = (id: string) => {
    const next = drafts.filter(draft => draft.id !== id);
    const replacementId = `new-${nextId.current}`;
    nextId.current += 1;
    setDrafts(next.length > 0 ? next : [emptyCustomDraft(replacementId)]);
    commitDrafts(next);
  };

  return (
    <div className="space-y-2">
      {drafts.map(draft => {
        const error = customDraftError({ draft, drafts, reservedKeys });
        const visibleError = draft.key.trim() === '' ? null : error;
        return (
          <div key={draft.id}>
            <div className="flex items-center">
              <div
                className={cn(
                  'bg-secondary-button-bg flex min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-input-border',
                  draft.type === 'json' && 'rounded-b-none',
                  visibleError && 'border-failure-bg',
                )}
              >
                <input
                  value={draft.key}
                  aria-label="Custom parameter name"
                  placeholder="Key"
                  className="text-text-primary placeholder:text-text-secondary h-8 min-w-0 flex-1 border-0 border-r border-input-border bg-transparent px-3 text-sm outline-none"
                  onChange={event => updateDraft({ id: draft.id, patch: { key: event.target.value } })}
                />
                {draft.type !== 'json' ? (
                  <input
                    type={draft.type === 'number' ? 'number' : 'text'}
                    value={draft.value}
                    aria-label={`Value for ${draft.key || 'custom parameter'}`}
                    placeholder="Value"
                    className="text-text-primary placeholder:text-text-secondary h-8 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm outline-none"
                    onChange={event => updateDraft({ id: draft.id, patch: { value: event.target.value } })}
                  />
                ) : null}
                <DropdownMenu
                  align="end"
                  className="w-32"
                  trigger={
                    <button
                      type="button"
                      aria-label={`Type for ${draft.key || 'custom parameter'}`}
                      title={draft.type === 'string' ? 'String' : draft.type === 'number' ? 'Number' : 'JSON'}
                      className="text-text-secondary hover:bg-ghost-button-hover flex h-8 w-12 shrink-0 items-center justify-center gap-1 border-l border-input-border text-xs font-semibold"
                    >
                      <span>{customParameterTypeMark(draft.type)}</span>
                      <Icon name="chevron-down" className="size-3" />
                    </button>
                  }
                >
                  {(['string', 'number', 'json'] as const).map(type => (
                    <DropdownMenuItem
                      key={type}
                      aria-selected={draft.type === type}
                      onClick={() =>
                        updateDraft({
                          id: draft.id,
                          patch: {
                            type,
                            value: type === 'number' ? '0' : type === 'json' ? '{}' : '',
                          },
                        })
                      }
                    >
                      <span aria-hidden className="w-5 text-center font-semibold">
                        {customParameterTypeMark(type)}
                      </span>
                      {type === 'string' ? 'String' : type === 'number' ? 'Number' : 'JSON'}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              </div>
              <div className="ml-3 flex items-center gap-3">
                <button
                  type="button"
                  aria-label={`Remove ${draft.key || 'custom parameter'}`}
                  className="text-failure-bg border-failure-bg flex size-5 items-center justify-center rounded-full border text-sm leading-none"
                  onClick={() => removeDraft(draft.id)}
                >
                  <span aria-hidden>−</span>
                </button>
                <button
                  type="button"
                  aria-label="Add parameter"
                  className={cn(
                    'text-text-secondary flex size-5 items-center justify-center rounded-full border border-current',
                    draft.id !== drafts.at(-1)?.id && 'invisible',
                  )}
                  onClick={() => {
                    const id = `new-${nextId.current}`;
                    nextId.current += 1;
                    const index = drafts.findIndex(candidate => candidate.id === draft.id);
                    const next = [...drafts];
                    next.splice(index + 1, 0, emptyCustomDraft(id));
                    setDrafts(next);
                  }}
                >
                  <Icon name="plus" className="size-3" />
                </button>
              </div>
            </div>
            {draft.type === 'json' ? (
              <CodeEditor
                value={draft.value}
                language="json"
                height="8rem"
                showToolbar={false}
                className={cn('mr-16 h-32 rounded-t-none border-t-0', visibleError && 'border-failure-bg')}
                onChange={entryValue => {
                  if (entryValue !== undefined) {
                    updateDraft({ id: draft.id, patch: { value: entryValue } });
                  }
                }}
              />
            ) : null}
            {visibleError ? <p className="text-failure-bg mt-1 text-xs">{visibleError}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentCustomParametersEditor: typeof AgentCustomParametersEditor;
  }
}
