'use client';

import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';
import { MonacoEditorCore } from './MonacoEditorCore.js';
import { ToolCallCard, type ToolCallStatus } from './ToolCallCard.js';

export type SandboxToolCallCardProps = {
  name: string;
  intent?: string;
  status: ToolCallStatus;
  expanded: boolean;
  onToggle: () => void;
  command?: string;
  exitCode?: number | null;
  argsJson?: string;
  resultText?: string;
  resultJson?: string;
  viewMode?: 'terminal' | 'code';
  hasContent?: boolean;
  onViewModeChange?: (viewMode: 'terminal' | 'code') => void;
  durationText?: string;
  dataTestPrefix?: string;
  className?: string;
};

function JsonPane({ value, className }: { value: string; className?: string }) {
  return (
    <MonacoEditorCore
      language="json"
      value={value}
      autoHeight
      maxHeight="10.5rem"
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbers: 'off',
        folding: true,
        fontSize: 12,
      }}
      className={cn('!border-0', className)}
    />
  );
}

function SandboxBody({
  command,
  exitCode,
  argsJson,
  resultText,
  resultJson,
  viewMode = 'terminal',
  hasContent = false,
  onViewModeChange,
  dataTestPrefix,
}: Pick<
  SandboxToolCallCardProps,
  | 'command'
  | 'exitCode'
  | 'argsJson'
  | 'resultText'
  | 'resultJson'
  | 'viewMode'
  | 'hasContent'
  | 'onViewModeChange'
  | 'dataTestPrefix'
>) {
  return (
    <div
      className="rounded-lg border border-border bg-background"
      data-testid={dataTestPrefix ? `${dataTestPrefix}-sandbox` : undefined}
    >
      <div className="rounded-t-md border-b border-primary/30 bg-primary/10">
        <div className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5">
          <p className="min-w-0 font-sans text-xs font-medium text-primary">sandbox</p>
          <div
            className="ml-auto flex shrink-0 items-center gap-1.5"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
          >
            {exitCode != null && (
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs lowercase',
                  exitCode === 0
                    ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'bg-destructive/10 text-destructive',
                )}
                data-testid={dataTestPrefix ? `${dataTestPrefix}-exit-code` : undefined}
              >
                <Icon name={exitCode === 0 ? 'circle-check' : 'circle-xmark'} size={12} />
                exit: {exitCode}
              </span>
            )}
            <div
              className="inline-flex h-6 items-center rounded-md border border-border bg-background p-0.5"
              role="group"
              aria-label="Sandbox view"
            >
              <button
                type="button"
                title="Terminal View"
                aria-label="Terminal View"
                aria-pressed={viewMode === 'terminal'}
                onClick={() => onViewModeChange?.('terminal')}
                className={cn(
                  'inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors',
                  viewMode === 'terminal' && 'bg-muted text-foreground shadow-sm',
                )}
              >
                <Icon name="terminal" size={12} />
              </button>
              <button
                type="button"
                title="Code View"
                aria-label="Code View"
                aria-pressed={viewMode === 'code'}
                onClick={() => onViewModeChange?.('code')}
                className={cn(
                  'inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors',
                  viewMode === 'code' && 'bg-muted text-foreground shadow-sm',
                )}
              >
                <Icon name="code" size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-b-lg border border-t-0 border-border p-3">
        {hasContent && (
          <div className="max-h-80 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">
            {viewMode === 'code' ? (
              <>
                {argsJson && (
                  <div className="my-1 border-l-4 border-primary px-3">
                    <div className="mb-1 font-sans text-xs font-medium leading-4">Arguments</div>
                    <JsonPane value={argsJson} className="pl-2" />
                  </div>
                )}
                {resultJson && (
                  <div className="my-1 border-l-4 border-purple-400 px-3">
                    <div className="mb-1 mt-2 font-sans text-xs font-medium leading-4">Result</div>
                    <JsonPane value={resultJson} className="pl-2" />
                  </div>
                )}
              </>
            ) : (
              <>
                {command && (
                  <div className="my-1 break-all border-l-4 border-primary px-3">
                    <div className="mb-1 text-[12px] font-medium leading-4 text-muted-foreground">COMMAND</div>
                    <div>
                      <span className="text-teal-500">$</span> {command}
                    </div>
                  </div>
                )}
                {resultText ? (
                  <>
                    <div className="mx-3 my-1 border-t border-border" />
                    <div className="my-1 break-all border-l-4 border-purple-400 px-3">
                      <div className="mb-1 text-[12px] font-medium leading-4 text-muted-foreground">OUTPUT</div>
                      <div>{resultText}</div>
                    </div>
                  </>
                ) : (
                  resultJson && (
                    <>
                      <div className="mx-3 my-1 border-t border-border" />
                      <div className="my-1 border-l-4 border-purple-400 px-3">
                        <div className="mb-1 text-[12px] font-medium leading-4 text-muted-foreground">OUTPUT</div>
                        <JsonPane value={resultJson} className="pl-2" />
                      </div>
                    </>
                  )
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SandboxToolCallCard({
  name,
  intent,
  status,
  expanded,
  onToggle,
  command,
  exitCode,
  argsJson,
  resultText,
  resultJson,
  viewMode = 'terminal',
  hasContent = false,
  onViewModeChange,
  durationText,
  dataTestPrefix,
  className,
}: SandboxToolCallCardProps) {
  const awaiting = status === 'running';

  return (
    <ToolCallCard
      toolName={intent || name}
      icon="cube"
      iconClassName="text-primary shrink-0"
      expanded={expanded}
      onToggle={onToggle}
      awaiting={awaiting}
      awaitingText={durationText ?? 'Running…'}
      showResponseLine={false}
      status={awaiting ? undefined : status}
      exitCode={exitCode}
      dataTestPrefix={dataTestPrefix}
      requestSlot={
        <SandboxBody
          command={command}
          exitCode={exitCode}
          argsJson={argsJson}
          resultText={resultText}
          resultJson={resultJson}
          viewMode={viewMode}
          hasContent={hasContent}
          onViewModeChange={onViewModeChange}
          dataTestPrefix={dataTestPrefix}
        />
      }
      className={cn('aui-sandbox-tool-call-card', className)}
    />
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SandboxToolCallCard: typeof SandboxToolCallCard;
  }
}
