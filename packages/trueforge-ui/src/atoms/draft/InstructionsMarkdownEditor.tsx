'use client';

import { useSlot } from '../../theme/SlotsProvider.js';
import { registerMarkdownFolding } from './registerMarkdownFolding.js';

const EDITOR_OPTIONS = {
  lineNumbers: 'on',
  renderFinalNewline: 'on',
  guides: { indentation: false },
  folding: true,
  showFoldingControls: 'always',
  renderLineHighlight: 'line',
  fontSize: 13,
  lineHeight: 20,
  padding: { top: 8, bottom: 8 },
};

/** Markdown source editor for agent instructions: line numbers and heading/code-block folding. */
export function InstructionsMarkdownEditor({
  value,
  onChange,
  height,
}: {
  value: string;
  onChange: (value: string) => void;
  height: string | number;
}) {
  const MonacoEditorCore = useSlot('MonacoEditorCore');
  return (
    <MonacoEditorCore
      value={value}
      language="markdown"
      options={EDITOR_OPTIONS}
      beforeMount={registerMarkdownFolding}
      onChange={onChange}
      height={height}
    />
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    InstructionsMarkdownEditor: typeof InstructionsMarkdownEditor;
  }
}
