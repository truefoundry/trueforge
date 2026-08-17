import type { Logger } from 'winston';
import type { AgentCapability } from '../core/capabilities/AgentCapability';
import type { AgentDefinition } from '../core/runtime/AgentDefinition';
import type { AgentInfo } from '../core/runtime/AgentThread.types';
import type { Sandbox, SandboxInfo } from '../core/sandbox/Sandbox';
import type { AgentTracing } from '../core/tracing/AgentTracing';
import type { TurnRecord } from './models/TurnRecord';
import type { AgentSpec } from './schemas/agentSpec';

/** Result of {@link ITurnResourceResolver.resolveAgentDefinition}. */
export interface ResolvedAgentDefinition {
  definition: AgentDefinition;
  extraCapabilities?: AgentCapability[] | undefined;
}

/**
 * Per-run wiring contract consumed by SessionHandle.createTurn(). Implementations hold
 * per-request state (secrets, providers, caches) freely.
 */
export interface ITurnResourceResolver<TTurnCustom extends object = Record<string, never>> {
  /** Forwarded to AgentThread / orchestrator / RemoteMCP. */
  readonly logger: Logger;
  /** Called exactly once per run, before any other method. */
  createTracing(): AgentTracing;
  /**
   * Look up the live AgentSpec for a named (ref) session agent.
   * Value sessions use the stored spec and never call this.
   */
  resolveAgentSpec(input: { agent_id: string }): Promise<AgentSpec>;
  /**
   * Called exactly once per run, before any thread is built; the harness holds
   * the result and shares the same reference across all threads. Return
   * undefined when the run needs no sandbox. `existing` carries the previous
   * turn's sandbox info for cross-turn reattach.
   */
  resolveSandbox(input: {
    spec: AgentSpec;
    existing?: SandboxInfo | undefined;
    previousTurn?: TurnRecord<TTurnCustom> | undefined;
    signal: AbortSignal;
    tracing: AgentTracing;
  }): Promise<Sandbox | undefined>;
  /**
   * Called once per thread (rebuild or live sub-agent spawn); calls for different
   * threads may overlap, so implementations must be concurrency-safe.
   * `agent_info` is set for sub-agent threads. `previousTurn` is read-only:
   * branch on it, but never load state into capabilities — return blank
   * instances; the AgentThread constructor is the sole hydration path.
   * `extraCapabilities` are appended after the built-in capabilities.
   */
  resolveAgentDefinition(input: {
    spec: AgentSpec;
    agent_info?: AgentInfo | undefined;
    previousTurn?: TurnRecord<TTurnCustom> | undefined;
    signal: AbortSignal;
    tracing: AgentTracing;
  }): Promise<ResolvedAgentDefinition>;
  /**
   * Release per-run resources. Called by the harness at the end of the run:
   * by TurnHandle.stream() in its finally (AFTER the terminal state write), or by
   * SessionHandle.createTurn() when it throws before a TurnHandle exists — so resources acquired
   * during a failed run (e.g. a sandbox VM) are still released. Best-effort:
   * the harness logs and swallows errors — close() can never flip a terminal
   * state or fail the turn. Must be idempotent. The resolver owns cleanup
   * because it owns acquisition: the run flow calls this one method without
   * knowing what was resolved.
   */
  close(): Promise<void>;
}
