import { randomUUID } from 'node:crypto';
import type { Logger } from 'winston';
import {
  EventType,
  newEventId,
  type ApprovalDecision,
  type CodeModeApprovalRequiredEvent,
  type ToolApprovalPolicy,
} from '../../events/schema';
import { signalable, type Signalable } from '../../util/promiseUtils';

const TURN_ENDED_REASON = 'Turn ended before approval was given';

/** One bridged tool call waiting on a human decision. */
export interface CodeModeApprovalRequest {
  threadId: string;
  /** Sandbox `exec` tool call the script is running under. */
  toolCallId: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface CodeModeApprovalResolution {
  decision: ApprovalDecision;
  /** Set when the user chose a remembered allow. A deny never carries one. */
  policy: ToolApprovalPolicy | undefined;
}

export interface CodeModeApprovalTicket {
  approvalId: string;
  decision: Promise<CodeModeApprovalResolution>;
}

interface PendingApproval {
  request: CodeModeApprovalRequest;
  settle: (resolution: CodeModeApprovalResolution) => void;
  /** Minted by `drain`; its presence means this call is the one currently on screen. */
  card: CodeModeApprovalRequiredEvent | undefined;
}

function denied(reason: string): CodeModeApprovalResolution {
  return { decision: { status: 'deny', reason }, policy: undefined };
}

/**
 * Per-turn registry of Code Mode calls waiting on a decision.
 *
 * Neither direction uses the orchestrator's event mailbox: that queue drains between thread
 * batches, and a parked script is inside the batch that would drain it. Cards leave through
 * `drain`, pulled by a generator merged into the running batch; decisions arrive through
 * `resolve`, called inline from `AgentThreadOrchestrator.send`.
 */
export class CodeModeApprovalBroker {
  /** Insertion-ordered, so the oldest waiting call for an `exec` is the one asked about. */
  private readonly pending = new Map<string, PendingApproval>();
  private readonly changed: Signalable = signalable();
  private readonly logger: Logger;
  private closed = false;

  constructor(params: { logger: Logger }) {
    this.logger = params.logger.child({ module: 'CodeModeApprovalBroker' });
  }

  /**
   * Registers a call and hands back its id synchronously, so the caller can reply with a
   * ticket without holding the sandbox bridge request open.
   */
  open(request: CodeModeApprovalRequest): CodeModeApprovalTicket {
    const approvalId = `cma_${randomUUID()}`;
    if (this.closed) {
      return { approvalId, decision: Promise.resolve(denied(TURN_ENDED_REASON)) };
    }
    let settle: ((resolution: CodeModeApprovalResolution) => void) | undefined;
    const decision = new Promise<CodeModeApprovalResolution>(resolve => {
      settle = resolve;
    });
    if (settle === undefined) {
      throw new Error('Unreachable: Promise executor did not run synchronously');
    }
    this.pending.set(approvalId, { request, settle, card: undefined });
    this.changed.notify();
    return { approvalId, decision };
  }

  /** The call behind an id, for validating a decision and naming its policy target. */
  requestFor(approvalId: string): CodeModeApprovalRequest | undefined {
    return this.pending.get(approvalId)?.request;
  }

  /** Every other waiting call on the same tool, so a remembered allow can settle them too. */
  pendingIdsForTool(input: { serverName: string; toolName: string }): string[] {
    return [...this.pending.entries()]
      .filter(([, e]) => e.request.serverName === input.serverName && e.request.toolName === input.toolName)
      .map(([approvalId]) => approvalId);
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /** Settles one waiting call. False when the id is unknown or was already decided. */
  resolve(input: { approvalId: string; resolution: CodeModeApprovalResolution }): boolean {
    const entry = this.pending.get(input.approvalId);
    if (entry === undefined) {
      return false;
    }
    this.pending.delete(input.approvalId);
    entry.settle(input.resolution);
    this.changed.notify();
    return true;
  }

  /**
   * Cards not yet emitted, at most one per `exec` tool call: the UI renders an approval
   * under the exec card that owns it, so a second card for the same exec has nowhere to go.
   * Calls behind the head wait their turn.
   */
  drain(): CodeModeApprovalRequiredEvent[] {
    const onScreen = new Set<string>();
    for (const entry of this.pending.values()) {
      if (entry.card !== undefined) {
        onScreen.add(entry.request.toolCallId);
      }
    }

    const cards: CodeModeApprovalRequiredEvent[] = [];
    for (const [approvalId, entry] of this.pending) {
      if (entry.card !== undefined || onScreen.has(entry.request.toolCallId)) {
        continue;
      }
      const card: CodeModeApprovalRequiredEvent = {
        type: EventType.CODE_MODE_APPROVAL_REQUIRED,
        id: newEventId(),
        created_at: new Date().toISOString(),
        thread_id: entry.request.threadId,
        approval_id: approvalId,
        tool_call_id: entry.request.toolCallId,
        server_name: entry.request.serverName,
        name: entry.request.toolName,
        arguments: entry.request.arguments,
      };
      entry.card = card;
      onScreen.add(entry.request.toolCallId);
      cards.push(card);
    }
    return cards;
  }

  /** Parks until something opens, settles, or `nudge` / `close` is called. */
  waitForChange(): Promise<void> {
    return this.changed.wait();
  }

  /**
   * Wakes `waitForChange` for a reason the broker cannot see. The batch's approval loop parks
   * here rather than on a thread generator, so without this it never notices a finishing batch.
   */
  nudge(): void {
    this.changed.notify();
  }

  /** Denies everything still waiting, so a settled turn cannot leave a script polling forever. */
  close(): void {
    this.closed = true;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) {
      entry.settle(denied(TURN_ENDED_REASON));
    }
    if (waiting.length > 0) {
      this.logger.info('Denied Code Mode approvals outstanding at turn end', { count: waiting.length });
    }
    this.changed.notify();
  }
}
