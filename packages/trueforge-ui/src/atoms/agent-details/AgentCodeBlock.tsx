'use client';

import { useSlot, useThemeMode } from '../../theme/SlotsProvider.js';
import type { AgentCodeBlockProps } from './types.js';

export function AgentCodeBlock({ code, language }: AgentCodeBlockProps) {
  const SyntaxHighlighter = useSlot('SyntaxHighlighter');
  const mode = useThemeMode();
  return (
    <SyntaxHighlighter
      code={code}
      language={language}
      showLineNumbers
      darkTheme={mode === 'dark'}
      // Stretch the highlighted `pre` past the code so its theme background fills the panel.
      className="m-0 flex min-h-full flex-col rounded-none [&>pre]:flex-1"
    />
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentCodeBlock: typeof AgentCodeBlock;
  }
}
