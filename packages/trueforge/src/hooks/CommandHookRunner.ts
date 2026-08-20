/**
 * Spawned-command lifecycle hooks (docs/key-features/hooks).
 *
 * Each configured entry runs with the system shell and receives one JSON
 * payload on stdin. Outcome contract per attempt:
 *
 *   exit 0 → stdout parsed as an ApprovalDecision ({"status":"allow"} or
 *            {"status":"deny","reason":"…"}); empty stdout = allow
 *   exit 2 → deny; trimmed stderr is the reason
 *   any other exit, spawn failure, timeout, or unparseable stdout → the
 *            entry's fail_mode: open = allow (default), closed = deny
 *
 * Entries for one event run sequentially; the first deny wins and later
 * entries are skipped. Methods resolve rather than throw (the
 * LifecycleHookRunner contract — a thrown error would fail the thread).
 *
 * One runner is constructed per turn so every payload carries the same
 * session/turn identity. Hooks execute on the process that owns the turn; in
 * multi-replica deployments that is whichever replica accepted the turn.
 */
import type { TurnInputItem } from '@truefoundry/trueforge-core/agent-session';
import {
  ApprovalDecisionSchema,
  type ApprovalDecision,
  type LifecycleHookRunner,
  type LifecycleHookToolCall,
  type LifecycleHookToolResult,
} from '@truefoundry/trueforge-core/core';
import { spawn } from 'node:child_process';
import type { Logger } from 'winston';
import type { HookCommand, HookEventName, HooksFile } from '../schemas/hooks';
import { killProcessTree } from '../utils/killProcessTree';

/** Caps captured stdout and stderr independently so a runaway hook cannot balloon memory. */
const MAX_CAPTURED_OUTPUT_BYTES = 1_048_576;

/**
 * Grace between the child's 'exit' and deciding from captured output. 'close'
 * waits for the stdio pipes, which a descendant that inherited them can hold
 * open indefinitely (a pipeline, a backgrounded child, cmd.exe's real command),
 * so the decision must not depend on 'close' ever firing.
 */
const STREAM_DRAIN_GRACE_MS = 100;

const ALLOW: ApprovalDecision = { status: 'allow' };

/** Exit code a hook uses to deny without printing a decision; stderr becomes the reason. */
const DENY_EXIT_CODE = 2;

export class CommandHookRunner implements LifecycleHookRunner {
  private readonly config: HooksFile;
  private readonly sessionId: string;
  private readonly turnId: string;
  private readonly logger: Logger;
  private readonly drainGraceMs: number;

  constructor(input: {
    config: HooksFile;
    sessionId: string;
    turnId: string;
    logger: Logger;
    /** Post-'exit' stream-drain grace override; tests pin it to make the timeout-vs-drain ordering deterministic. */
    drainGraceMs?: number;
  }) {
    this.config = input.config;
    this.sessionId = input.sessionId;
    this.turnId = input.turnId;
    this.logger = input.logger.child({ module: 'CommandHookRunner' });
    this.drainGraceMs = input.drainGraceMs ?? STREAM_DRAIN_GRACE_MS;
  }

  hasHooksFor(event: HookEventName): boolean {
    return this.config.hooks[event].length > 0;
  }

  /** Fires before the turn is created; a deny rejects the prompt. */
  userPromptSubmit(input: { prompt: string; items: TurnInputItem[] }): Promise<ApprovalDecision> {
    return this.runBlockingEvent('user_prompt_submit', { prompt: input.prompt, input: input.items });
  }

  preToolUse(call: LifecycleHookToolCall): Promise<ApprovalDecision> {
    return this.runBlockingEvent('pre_tool_use', { tool_name: call.toolName, tool_input: call.toolInput ?? null });
  }

  async postToolUse(result: LifecycleHookToolResult): Promise<void> {
    await this.runObservationalEvent('post_tool_use', {
      tool_name: result.toolName,
      tool_input: result.toolInput ?? null,
      tool_response: result.toolResponse,
      is_error: result.isError,
    });
  }

  /** Fires once per turn after the terminal event is durable. Observational only. */
  async turnDone(input: { status: string }): Promise<void> {
    await this.runObservationalEvent('turn_done', { status: input.status });
  }

  /**
   * Serialized once per event (tool responses can be multi-MB) and guarded:
   * unserializable input (an embedder toolset yielding BigInt/circular values)
   * must degrade per policy, never reject the runner.
   */
  private serializePayload(event: HookEventName, fields: Record<string, unknown>): string | undefined {
    try {
      return JSON.stringify({
        hook_event_name: event,
        session_id: this.sessionId,
        turn_id: this.turnId,
        ...fields,
      });
    } catch (error) {
      this.logger.error('Hook payload is not serializable', {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /** Entries run sequentially; the first deny wins and later entries are skipped. */
  private async runBlockingEvent(event: HookEventName, fields: Record<string, unknown>): Promise<ApprovalDecision> {
    const payloadJson = this.serializePayload(event, fields);
    if (payloadJson === undefined) {
      const closedEntry = this.config.hooks[event].find(hook => hook.fail_mode === 'closed');
      return closedEntry ? this.failureDecision(event, closedEntry, 'unserializable payload') : ALLOW;
    }
    for (const hook of this.config.hooks[event]) {
      const decision = await this.runCommand(event, hook, payloadJson);
      if (decision.status === 'deny') {
        return decision;
      }
    }
    return ALLOW;
  }

  /** Every entry runs regardless of individual outcomes — a deny has no meaning here. */
  private async runObservationalEvent(event: HookEventName, fields: Record<string, unknown>): Promise<void> {
    const payloadJson = this.serializePayload(event, fields);
    if (payloadJson === undefined) {
      return;
    }
    for (const hook of this.config.hooks[event]) {
      await this.runCommand(event, hook, payloadJson);
    }
  }

  private failureDecision(event: HookEventName, hook: HookCommand, why: string): ApprovalDecision {
    if (hook.fail_mode === 'closed') {
      return { status: 'deny', reason: `${event} hook failed (${why}) and fail_mode is closed` };
    }
    return ALLOW;
  }

  private runCommand(event: HookEventName, hook: HookCommand, payloadJson: string): Promise<ApprovalDecision> {
    return new Promise(resolve => {
      // detached on POSIX puts the shell in its own process group so the
      // timeout can kill the whole tree (see killHookProcessTree).
      const child = spawn(hook.command, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      // Independent caps: stderr volume must never evict the stdout decision.
      const capture = (sink: Buffer[]) => {
        let capturedBytes = 0;
        return (chunk: Buffer) => {
          if (capturedBytes < MAX_CAPTURED_OUTPUT_BYTES) {
            capturedBytes += chunk.byteLength;
            sink.push(chunk);
          }
        };
      };
      child.stdout.on('data', capture(stdoutChunks));
      child.stderr.on('data', capture(stderrChunks));
      // No stdio error may crash the process: stdin EPIPEs when the command
      // exits without reading it, and the read sides can error after a kill
      // (e.g. ECONNRESET on Windows pipes). The exit/close path still decides
      // from whatever output was captured, so these only defuse the throw.
      child.stdin.on('error', () => {
        /* no-op */
      });
      child.stdout.on('error', () => {
        /* no-op */
      });
      child.stderr.on('error', () => {
        /* no-op */
      });

      let settled = false;
      let closed = false;
      let drainTimer: NodeJS.Timeout | undefined;
      let exitResult: { code: number | null; signal: NodeJS.Signals | null } | undefined;

      // References `timeout`, declared below; only invoked after it exists.
      // Clears the deadline timer only once 'close' released the pipes — until
      // then it stays armed (unref'd) as the straggler reaper.
      const settle = (decision: ApprovalDecision) => {
        if (!settled) {
          settled = true;
          if (closed) {
            clearTimeout(timeout);
          }
          if (drainTimer !== undefined) {
            clearTimeout(drainTimer);
          }
          resolve(decision);
        }
      };

      const timeout = setTimeout(() => {
        if (!settled) {
          if (exitResult !== undefined) {
            // The process already exited within budget — only pipe-holding
            // descendants kept 'close' (and the drain grace) from settling
            // yet. Honor the real captured outcome instead of a timeout.
            settleFromOutput(exitResult.code, exitResult.signal);
          } else {
            // Settle NOW and then kill: waiting for 'close' would hang forever
            // when a descendant inherited the stdio pipes, and 'exit' alone
            // leaves the hook's work running past its budget.
            this.logger.warn('Hook command timed out', { event, command: hook.command, timeoutMs: hook.timeout_ms });
            settle(this.failureDecision(event, hook, `timeout after ${String(hook.timeout_ms)}ms`));
          }
        }
        // The budget elapsed with the pipes still held: reap the process group
        // even when the command itself exited in time — its stragglers are the
        // ones pinning the hook's stdio.
        killProcessTree(child);
      }, hook.timeout_ms);
      timeout.unref();

      const settleFromOutput = (code: number | null, signal: NodeJS.Signals | null) => {
        // Also gates the post-settle 'exit'/'close' replays of a timed-out
        // hook, which would otherwise log spurious non-zero-exit warnings.
        if (settled) {
          return;
        }
        const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        if (code === DENY_EXIT_CODE) {
          settle({ status: 'deny', reason: stderr === '' ? 'blocked by hook' : stderr });
          return;
        }
        if (code !== 0) {
          this.logger.warn('Hook command exited non-zero', { event, command: hook.command, code, signal, stderr });
          const why = code === null ? `killed by signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`;
          settle(this.failureDecision(event, hook, why));
          return;
        }
        if (stdout === '') {
          settle(ALLOW);
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          this.logger.warn('Hook command stdout is not JSON', { event, command: hook.command });
          settle(this.failureDecision(event, hook, 'unparseable stdout'));
          return;
        }
        const decision = ApprovalDecisionSchema.safeParse(parsed);
        if (!decision.success) {
          this.logger.warn('Hook command stdout is not a decision', { event, command: hook.command });
          settle(this.failureDecision(event, hook, 'unparseable stdout'));
          return;
        }
        settle(decision.data);
      };

      // Fires instead of (or before) close on spawn failure, e.g. no shell.
      child.on('error', error => {
        this.logger.warn('Hook command failed to spawn', {
          event,
          command: hook.command,
          error: error.message,
        });
        // Nothing spawned, so there are no pipes to reap.
        closed = true;
        clearTimeout(timeout);
        settle(this.failureDecision(event, hook, 'spawn failure'));
      });

      // 'close' (process exited AND pipes drained) is the preferred settle
      // point, but a descendant holding the inherited pipes can delay it
      // forever — so 'exit' arms a short drain grace as the fallback.
      child.on('exit', (code, signal) => {
        exitResult = { code, signal };
        if (settled) {
          return;
        }
        drainTimer = setTimeout(() => {
          settleFromOutput(code, signal);
        }, this.drainGraceMs);
      });
      child.on('close', (code, signal) => {
        // Pipes released — nothing left to reap at the deadline.
        closed = true;
        clearTimeout(timeout);
        settleFromOutput(code, signal);
      });

      child.stdin.end(payloadJson);
    });
  }
}
