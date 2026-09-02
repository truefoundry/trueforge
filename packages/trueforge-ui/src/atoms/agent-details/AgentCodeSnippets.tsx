'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { Icon } from '../../icons/Icon.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { cn } from '../lib/cn.js';
import type { AgentCodeSnippetsProps } from './types.js';

type SnippetMode = 'stream' | 'nonStream';

export default function AgentCodeSnippets({ snippets }: AgentCodeSnippetsProps) {
  const AgentCodeBlock = useSlot('AgentCodeBlock');
  const [selectedLanguage, setSelectedLanguage] = useState(snippets[0]?.language);
  const [mode, setMode] = useState<SnippetMode>('stream');

  useEffect(() => {
    setSelectedLanguage(snippets[0]?.language);
    setMode('stream');
  }, [snippets]);

  const selected = snippets.find(snippet => snippet.language === selectedLanguage) ?? snippets[0];

  if (selected === undefined) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center px-6 text-sm text-text-secondary">
        No code samples for this agent.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
      <nav aria-label="Code sample languages" className="flex shrink-0 gap-1 overflow-auto md:w-44 md:flex-col">
        {snippets.map(snippet => (
          <button
            key={snippet.language}
            type="button"
            aria-current={selected.language === snippet.language ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-xs text-text-secondary',
              'hover:bg-ghost-button-hover hover:text-text-primary',
              selected.language === snippet.language && 'bg-primary-button-bg/10 font-medium text-primary-button-bg',
            )}
            onClick={() => setSelectedLanguage(snippet.language)}
          >
            {snippet.icon ? (
              <img src={snippet.icon} alt="" className="size-4 shrink-0 object-contain" />
            ) : (
              <Icon name="code" className="size-4 shrink-0" />
            )}
            {snippet.labelName}
          </button>
        ))}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card-bg">
        <div className="flex h-10 shrink-0 items-end gap-1 border-b border-border px-3">
          {(
            [
              ['stream', 'Stream'],
              ['nonStream', 'Non-stream'],
            ] satisfies Array<[SnippetMode, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                'relative h-10 cursor-pointer px-3 text-xs font-medium text-text-secondary',
                mode === id &&
                  'text-primary-button-bg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary-button-bg',
              )}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <AgentCodeBlock code={selected.sampleCode[mode]} language={selected.language} />
        </div>
      </section>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentCodeSnippets: ComponentType<AgentCodeSnippetsProps>;
  }
}
