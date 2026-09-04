'use client';

import { useCallback, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import type { MonacoEditorCoreProps } from './MonacoEditorCore.js';

export type CodeEditorProps = Omit<MonacoEditorCoreProps, 'onAutoHeightChange' | 'options'> & {
  filename?: string;
  showToolbar?: boolean;
};

function ToolbarButton({
  onClick,
  tooltip,
  icon,
  active,
  variant = 'ghost',
}: {
  onClick: () => void;
  tooltip: string;
  icon: string;
  active?: boolean;
  variant?: 'ghost' | 'secondary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={auiButtonClass({
        variant,
        size: 'icon',
        className: cn(
          'h-7 w-7 shrink-0',
          variant === 'ghost' && 'text-text-secondary hover:text-text-primary',
          active && 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text',
        ),
      })}
      aria-label={tooltip}
    >
      <Icon name={icon} size="0.875em" />
    </button>
  );
}

export function CodeEditor({
  value,
  language,
  theme,
  filename,
  onChange,
  onMount,
  beforeMount,
  className,
  height,
  showToolbar = true,
}: CodeEditorProps) {
  const MonacoEditorCore = useSlot('MonacoEditorCore');
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `code.${language ?? 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [value, filename, language]);

  const editorOptions = {
    lineNumbers: showLineNumbers ? 'on' : ('off' as const),
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    // Avoid a blank numbered line when the buffer ends with `\n`.
    renderFinalNewline: 'off' as const,
    wordWrap: 'on' as const,
  };

  const editorHeight = expanded ? '100%' : (height ?? 320);

  return (
    <div
      className={cn(
        'aui-code-editor flex flex-col overflow-hidden rounded-md border border-border',
        expanded && 'fixed inset-4 z-50 bg-primary-bg shadow-2xl',
        className,
      )}
    >
      {showToolbar && (
        <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-1">
          {filename && <span className="truncate text-xs text-text-secondary">{filename}</span>}
          <div className="ml-auto flex items-center gap-0.5">
            <ToolbarButton
              onClick={() => setShowLineNumbers(v => !v)}
              tooltip={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
              icon="list-ol"
              active={showLineNumbers}
            />
            <ToolbarButton
              onClick={handleCopy}
              tooltip={copied ? 'Copied!' : 'Copy'}
              icon={copied ? 'check' : 'copy'}
              variant="secondary"
            />
            <ToolbarButton onClick={handleDownload} tooltip="Download" icon="download" />
            <ToolbarButton
              onClick={() => setExpanded(v => !v)}
              tooltip={expanded ? 'Collapse' : 'Expand'}
              icon={expanded ? 'compress' : 'expand'}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden" style={expanded ? undefined : { height: editorHeight }}>
        <MonacoEditorCore
          value={value}
          language={language}
          theme={theme}
          options={editorOptions}
          onChange={onChange}
          onMount={onMount}
          beforeMount={beforeMount}
          height="100%"
        />
      </div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    CodeEditor: typeof CodeEditor;
  }
}
