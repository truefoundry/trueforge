'use client';

import {
  useTrueFoundryAdoptAgentSpec,
  useTrueFoundryAgentSpec,
  useTrueFoundryFlushAgentSpec,
} from '@truefoundry/assistant-ui-runtime';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuiState } from '../assistant-ui.js';
import { Icon } from '../icons/Icon.js';
import { hasGenerateInstructionsFromChat } from '../server/generateInstructionsFromChat.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { auiInputClass } from './lib/inputClasses.js';
import { CenteredModal } from './primitives/CenteredModal.js';

export type GenerateInstructionsButtonProps = {
  disabled?: boolean;
  className?: string;
};

export function useGenerateInstructionsVisible(): boolean {
  const shell = useOptionalShellMode();
  const server = useOptionalServer();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  if (shell == null || shell.mode.status !== 'active') return false;
  if (remoteId == null || remoteId.length === 0) return false;
  return hasGenerateInstructionsFromChat(server);
}

export function GenerateInstructionsButton({ disabled = false, className }: GenerateInstructionsButtonProps) {
  const visible = useGenerateInstructionsVisible();
  if (!visible) return null;
  return <GenerateInstructionsButtonContent disabled={disabled} className={className} />;
}

function GenerateInstructionsButtonContent({ disabled, className }: { disabled: boolean; className?: string }) {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const { agentSpec } = useTrueFoundryAgentSpec();
  const agentSpecRef = useRef(agentSpec);
  agentSpecRef.current = agentSpec;
  const flushAgentSpec = useTrueFoundryFlushAgentSpec();
  const adoptAgentSpec = useTrueFoundryAdoptAgentSpec();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [sources, setSources] = useState<Array<{ turnId: string; role: 'user' | 'assistant'; excerpt: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const inFlightRef = useRef(false);
  const canApply = shell?.mode.status === 'active' && shell.mode.isMutable && agentSpec != null;

  useEffect(() => {
    if (error === null) return;
    errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const close = () => {
    if (loading || applying) return;
    setOpen(false);
    setDraft('');
    setSources([]);
    setError(null);
    setCopied(false);
  };

  const generate = async () => {
    if (!hasGenerateInstructionsFromChat(server) || remoteId == null || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const result = await server.generateInstructionsFromChat({ sessionId: remoteId });
      setDraft(result.instructions);
      setSources(result.sources);
    } catch (caught) {
      setDraft('');
      setSources([]);
      setError(getErrorMessage(caught, 'Could not generate instructions from this chat'));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const show = () => {
    if (inFlightRef.current || loading || applying) return;
    setOpen(true);
    void generate();
  };

  const apply = async () => {
    if (!canApply || agentSpecRef.current === null || remoteId == null || !hasGenerateInstructionsFromChat(server)) {
      return;
    }
    const instructions = draft.trim();
    if (instructions.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      await flushAgentSpec();
      const latest = agentSpecRef.current;
      if (latest === null) return;
      const next = { ...latest, instructions };
      const updated = await server.updateSession({ sessionId: remoteId, agentSpec: next });
      adoptAgentSpec({ agentSpec: next, updatedAt: updated.updatedAt });
      setOpen(false);
      setDraft('');
      setSources([]);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Could not apply instructions to this chat'));
    } finally {
      setApplying(false);
    }
  };

  const copyDraft = async () => {
    if (draft.trim().length === 0 || typeof navigator === 'undefined' || navigator.clipboard == null) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled || loading || applying || open}
        className={auiButtonClass({ variant: 'ghost', size: 'sm', className })}
        onClick={show}
      >
        <Icon name="lightbulb" className="size-3.5" />
        From chat
      </button>

      <CenteredModal
        open={open}
        onOpenChange={next => !next && close()}
        title="Instructions from this chat"
        className="md:h-auto md:max-h-[85dvh] md:max-w-2xl"
        aria-label="Instructions from this chat"
      >
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            <p className="text-text-secondary mb-3 text-sm">
              This is a draft from the conversation. Edit it before it becomes this chat&apos;s system instructions.
              Nothing is saved until you apply it.
            </p>

            <label className="mb-3 block" htmlFor={titleId}>
              <span className="mb-1.5 block text-sm font-medium">Suggested instructions</span>
              <textarea
                id={titleId}
                value={draft}
                disabled={loading || applying}
                onChange={event => setDraft(event.target.value)}
                rows={8}
                placeholder={loading ? 'Reading this chat…' : 'No suggestion yet.'}
                className={auiInputClass('resize-y py-2 disabled:opacity-60')}
              />
            </label>

            {sources.length > 0 ? (
              <div className="mb-3">
                <p className="text-text-secondary mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  Inferred from
                </p>
                <ul className="space-y-1.5">
                  {sources.map(source => (
                    <li
                      key={`${source.turnId}-${source.role}-${source.excerpt}`}
                      className="text-text-secondary text-xs"
                    >
                      <span className="text-text-primary font-medium">{source.role}</span>
                      {': '}
                      {source.excerpt}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {canApply ? null : (
              <p className="text-text-secondary mb-2 text-xs">
                This chat is bound to a saved agent, so the draft is not applied here. Copy it, or save a new agent.
              </p>
            )}

            {error ? (
              <p
                ref={errorRef}
                role="alert"
                className="text-failure-bg mt-2 text-sm wrap-break-word whitespace-pre-wrap"
              >
                {error}
              </p>
            ) : null}
          </div>

          <div className="bg-card-bg sticky bottom-0 z-10 flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
            <button
              type="button"
              disabled={loading || applying}
              className={auiButtonClass({ variant: 'secondary' })}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading || applying || draft.trim().length === 0}
              className={auiButtonClass({ variant: 'secondary' })}
              onClick={() => void copyDraft()}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            {canApply ? (
              <button
                type="button"
                disabled={loading || applying || draft.trim().length === 0}
                className={auiButtonClass({ variant: 'default' })}
                onClick={() => void apply()}
              >
                {applying ? 'Applying…' : 'Apply to this chat'}
              </button>
            ) : null}
          </div>
        </div>
      </CenteredModal>
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    GenerateInstructionsButton: typeof GenerateInstructionsButton;
  }
}
