import type { Logger } from 'winston';
import type { ILLM } from '../core/llm/ILLM';
import type { ToolSource } from '../core/mcp/IMCPServer';
import { RemoteMCP, type RemoteMcpHeaders } from '../core/mcp/RemoteMCP';
import type { ToolSelectorConfig } from '../core/mcp/ToolSelectorPolicy';
import { ToolSet } from '../core/mcp/ToolSet';
import type { ModelParams } from '../core/runtime/AgentDefinition';
import type { AgentInfo } from '../core/runtime/AgentThread.types';
import type { Sandbox, SandboxInfo } from '../core/sandbox/Sandbox';
import type { AgentTracing } from '../core/tracing/AgentTracing';
import { NOOP_AGENT_TRACING } from '../core/tracing/NoopAgentTracing';
import type { ITurnResourceResolver, ResolvedAgentDefinition } from './ITurnResourceResolver';
import type { TurnRecord } from './models/TurnRecord';
import type { AgentSpec } from './schemas/agentSpec';

/**
 * Factory that creates a Sandbox handle for a run (reattach via
 * existingSandboxId). `spec` carries the sandbox-relevant agent settings
 * (e.g. config.sandbox.file_downloads) so implementations can shape the
 * Sandbox per run without the factory type growing a field per option.
 */
export type TurnSandboxFactory = (input: {
  spec: AgentSpec;
  existingSandboxId?: string | undefined;
  signal: AbortSignal;
  tracing: AgentTracing;
}) => Promise<Sandbox>;

function specWantsSandbox(spec: AgentSpec): boolean {
  return spec.config.sandbox.enabled;
}

function toSelectors(entry: {
  enable_tools: string[];
  disable_tools: string[];
  preload_tools: string[];
  require_approval_for_tools: string[];
}): ToolSelectorConfig {
  return {
    enableTools: entry.enable_tools,
    disableTools: entry.disable_tools,
    preloadTools: entry.preload_tools,
    requireApprovalForTools: entry.require_approval_for_tools,
  };
}

/**
 * Batteries-included base implementation. Construct-and-go for the default
 * behavior; subclass and override to customize (tool sources, sandbox,
 * tracing).
 */
export class TurnResourceResolver<
  TTurnCustom extends object = Record<string, never>,
> implements ITurnResourceResolver<TTurnCustom> {
  readonly #sources = new Map<string, Promise<ToolSource>>();
  #sandbox?: Sandbox | undefined;

  constructor(
    protected readonly deps: {
      /** Model name → client and defaults. Called once per resolved definition; may load provider config. */
      llm: (model: string) => Promise<{
        modelClient: ILLM;
        defaultModelParams: ModelParams;
      }>;
      /**
       * MCP server name → connection details. Required to use spec.mcp_servers:
       * the AgentSpec carries names only (no url/headers on the wire) — the
       * runtime supplies the catalog. Called once per distinct server name per
       * turn. Throw for unknown names. `headers` supports the async resolver form.
       */
      mcp: (name: string) => Promise<{ url: string; headers?: RemoteMcpHeaders }>;
      mcpRequestTimeoutMs: number;
      mcpConnectTimeoutMs: number;
      /** One sandbox type per runtime. Omit = no sandbox support. */
      sandboxProvider?: TurnSandboxFactory | undefined;
      /**
       * Named-agent lookup (registry id → live AgentSpec). Required when a
       * session is bound by reference; omit only if all sessions use inline agents.
       */
      agent?: ((agentId: string) => Promise<AgentSpec>) | undefined;
      /** Forwarded to RemoteMCP / AgentThread (required by their constructors). */
      logger: Logger;
    },
  ) {}

  get logger(): Logger {
    return this.deps.logger;
  }

  /** Default: no-op tracing. Override to plug in a real tracer. */
  createTracing(): AgentTracing {
    return NOOP_AGENT_TRACING;
  }

  /** Named (ref) session agent → live registry lookup via deps.agent. */
  async resolveAgentSpec(input: { agent_id: string }): Promise<AgentSpec> {
    if (this.deps.agent === undefined) {
      // Host forgot to wire deps.agent — not "agent id missing from the registry"
      // (that failure belongs in the lookup callback, e.g. HTTP 422 on the server).
      throw new Error(
        `Named agent '${input.agent_id}' cannot be resolved: no agent lookup configured on the turn resolver`,
      );
    }
    return await this.deps.agent(input.agent_id);
  }

  /**
   * Default: creates a sandbox iff a provider is configured AND the spec wants
   * one; reattaches to the previous turn's VM via `existing.sandbox_id` when
   * present. Overrides that resolve their own sandbox must assign it so
   * close() can release it (or override close() too).
   */
  async resolveSandbox(input: {
    spec: AgentSpec;
    existing?: SandboxInfo | undefined;
    previousTurn?: TurnRecord<TTurnCustom> | undefined;
    signal: AbortSignal;
    tracing: AgentTracing;
  }): Promise<Sandbox | undefined> {
    if (!this.deps.sandboxProvider || !specWantsSandbox(input.spec)) {
      return undefined;
    }
    this.#sandbox = await this.deps.sandboxProvider({
      spec: input.spec,
      existingSandboxId: input.existing?.sandbox_id,
      signal: input.signal,
      tracing: input.tracing,
    });
    return this.#sandbox;
  }

  /**
   * Closes the sandbox HANDLE if one was resolved. This releases only this
   * process's connection (local bridge); the sandbox VM keeps running and the
   * next turn reattaches via `existing.sandbox_id`.
   *
   * Tool sources (MCP connections) are intentionally NOT closed: the run's
   * AbortSignal already aborts their in-flight calls, and connections are
   * per-run objects that are simply dropped. If deterministic MCP socket
   * release is ever needed, add it here — no contract change required.
   *
   * Subclasses that acquire additional resources MUST override, release
   * their own resources best-effort, and call `await super.close()`.
   * Idempotent; never throws.
   */
  async close(): Promise<void> {
    const sandbox = this.#sandbox;
    this.#sandbox = undefined;
    await sandbox?.close().catch(() => {
      /* no-op */
    });
  }

  /**
   * Default: maps the spec directly to a definition — spec.mcp_servers carry
   * names only; deps.mcp resolves each name to url/headers, and the result
   * becomes a RemoteMCP source (deduped per turn via getOrCreateToolSource)
   * wrapped in a per-agent ToolSet view. Passes the previous turn's persisted
   * MCP session_id into RemoteMCP for cross-turn stateful resume.
   */
  async resolveAgentDefinition(input: {
    spec: AgentSpec;
    agent_info?: AgentInfo | undefined;
    previousTurn?: TurnRecord<TTurnCustom> | undefined;
    signal: AbortSignal;
    tracing: AgentTracing;
  }): Promise<ResolvedAgentDefinition> {
    const { spec, agent_info: agentInfo, previousTurn, signal, tracing } = input;
    const toolSets = await Promise.all(
      (spec.mcp_servers ?? []).map(async entry => {
        const source = await this.getOrCreateToolSource({
          id: entry.name,
          create: async () => {
            const { url, headers } = await this.deps.mcp(entry.name);
            return new RemoteMCP({
              id: entry.name,
              name: entry.name,
              url,
              headers: headers ?? {},
              sessionId: previousTurn?.snapshot.mcp_servers?.[entry.name]?.session_id,
              requestTimeoutMs: this.deps.mcpRequestTimeoutMs,
              connectTimeoutMs: this.deps.mcpConnectTimeoutMs,
              logger: this.deps.logger,
              tracing,
              signal,
            });
          },
        });
        return new ToolSet({
          source,
          selectors: toSelectors(entry),
          preload: entry.preload,
        });
      }),
    );
    // Sub-agents may request a different catalog model via agent_info.model;
    // resolve that name so modelClient matches the override (not just a label).
    const modelName = agentInfo?.model ?? spec.model.name;
    const resolvedModel = await this.deps.llm(modelName);
    return {
      definition: {
        modelClient: resolvedModel.modelClient,
        // Sub-agents receive the delegated task as a user message; their system
        // prompt is SUB_AGENT_IDENTITY (added by AgentThread), not user instructions.
        instruction: agentInfo ? undefined : spec.instructions,
        messages: agentInfo
          ? [{ role: 'user' as const, content: agentInfo.input }]
          : spec.messages?.map(m => ({ role: 'user' as const, content: m.content })),
        modelParams: {
          ...resolvedModel.defaultModelParams,
          ...spec.model.params,
        },
        // Sub-agents should return free-form summaries to the parent, not the user-facing structured response.
        responseFormat: agentInfo ? undefined : spec.response_format,
        iterationLimit: spec.config.iteration_limit,
        toolSets,
      },
    };
  }

  /**
   * Returns the tool source for `id`, creating it on first call — use from
   * resolveAgentDefinition overrides so agents sharing a server share one
   * connection. Single-flight by id: the promise is stored synchronously (no
   * await between get and set), so overlapping resolveAgentDefinition calls
   * can never double-create. Rejections stay cached: one attempt per turn.
   * Do not override.
   */
  protected getOrCreateToolSource(input: { id: string; create: () => Promise<ToolSource> }): Promise<ToolSource> {
    const cached = this.#sources.get(input.id);
    if (cached) {
      return cached;
    }
    const made = input.create();
    this.#sources.set(input.id, made);
    return made;
  }
}
