import type { Logger } from 'winston';
import type { AgentCapability } from '../core/capabilities/AgentCapability';
import { AgentHarnessError } from '../core/errors';
import type { ToolApprovalPolicy } from '../core/events/schema';
import type { ILLM } from '../core/llm/ILLM';
import type { ModelParams } from '../core/llm/model';
import type { VercelAIProviderName } from '../core/llm/VercelAILLM';
import type { ToolSource } from '../core/mcp/IMCPServer';
import { RemoteMCP, type McpConnection } from '../core/mcp/RemoteMCP';
import type { ToolSelectorConfig } from '../core/mcp/ToolSelectorPolicy';
import {
  DEFAULT_DISABLE_TOOLS,
  DEFAULT_ENABLE_TOOLS,
  DEFAULT_PRELOAD_TOOLS,
  DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS,
} from '../core/mcp/toolSelectors';
import { ToolSet } from '../core/mcp/ToolSet';
import {
  AUTO_MODEL,
  createModelRouter,
  type ModelRouterDeps,
  type RouteInput,
  type RoutedModel,
} from '../core/modelRouting/router';
import type { AgentModel } from '../core/runtime/AgentModel';
import type { AgentInfo, ModelSnapshot } from '../core/runtime/AgentThread.types';
import type { HarnessSandbox, SandboxInfo } from '../core/sandbox/Sandbox';
import type { AgentTracing } from '../core/tracing/AgentTracing';
import { NOOP_AGENT_TRACING } from '../core/tracing/NoopAgentTracing';
import type { IWebSearchProvider } from '../core/web-search/WebSearchProvider';
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
}) => Promise<HarnessSandbox>;

function specWantsSandbox(spec: AgentSpec): boolean {
  return spec.config.sandbox.enabled;
}

/** A saved effort replaces the freshly resolved one. `null` means the thread ran with none. */
function applySavedEffort(baseParams: ModelParams, effort: string | null | undefined): ModelParams {
  if (effort === undefined) {
    return baseParams;
  }
  if (effort === null) {
    const params = { ...baseParams };
    delete params.reasoning_effort;
    return params;
  }
  return { ...baseParams, reasoning_effort: effort };
}

/** Runtime id and display name of the built-in TrueForge management MCP. */
export const TRUEFORGE_MCP_ID = 'trueforge:mcp';

const TRUEFORGE_MCP_SELECTORS: ToolSelectorConfig = {
  enableTools: DEFAULT_ENABLE_TOOLS,
  disableTools: DEFAULT_DISABLE_TOOLS,
  preloadTools: DEFAULT_PRELOAD_TOOLS,
  requireApprovalForTools: DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS,
};

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
interface ResolvedModel {
  modelClient: ILLM;
  defaultModelParams: ModelParams;
  modelProperties?: AgentModel['properties'];
  /** Explicit `undefined` when the host has no provider label for the model call series. */
  providerType: VercelAIProviderName | undefined;
}

export class TurnResourceResolver<
  TTurnCustom extends object = Record<string, never>,
> implements ITurnResourceResolver<TTurnCustom> {
  readonly #sources = new Map<string, Promise<ToolSource>>();
  readonly #models = new Map<string, Promise<ResolvedModel>>();
  #sandbox?: HarnessSandbox | undefined;
  readonly maxParallelSubAgents?: number;
  readonly routeModel: ((route: RouteInput) => Promise<RoutedModel | undefined>) | undefined;

  constructor(
    protected readonly deps: {
      /** Model name → client and defaults. Called once per resolved definition; may load provider config. */
      llm: (model: string) => Promise<ResolvedModel>;
      /**
       * MCP id → connection. Spec servers use their name as the id.
       * {@link TRUEFORGE_MCP_ID} is the built-in management server; return undefined when this turn
       * should not mount it. Throw for an unknown spec server. Called once per distinct id per turn.
       */
      mcp: (id: string) => Promise<McpConnection | undefined>;
      mcpRequestTimeoutMs: number;
      mcpConnectTimeoutMs: number;
      mcpMaxResponseBytes?: number | undefined;
      maxParallelSubAgents?: number;
      /** One sandbox type per runtime. Omit = no sandbox support. */
      sandboxProvider?: TurnSandboxFactory | undefined;
      /**
       * Named-agent lookup (registry id → live AgentSpec). Required when a
       * session is bound by reference; omit only if all sessions use inline agents.
       */
      agent?: ((agentId: string) => Promise<AgentSpec>) | undefined;
      /** Host web-search backend; omit when not configured. */
      webSearchProvider?: IWebSearchProvider | undefined;
      /**
       * Main-thread capabilities. Called once per root resolve, so each call gets fresh instances.
       * A child thread passes `agent_info` and does not receive these. A subclass that replaces
       * `resolveAgentDefinition` without calling `super` does not mount them.
       */
      rootCapabilities?: (() => readonly AgentCapability[]) | undefined;
      /** Inputs for routing a thread to a model; undefined to not route. */
      modelRouting: ModelRouterDeps | undefined;
      /** Forwarded to RemoteMCP / AgentThread (required by their constructors). */
      logger: Logger;
    },
  ) {
    if (deps.maxParallelSubAgents !== undefined) {
      this.maxParallelSubAgents = deps.maxParallelSubAgents;
    }
    this.routeModel = deps.modelRouting === undefined ? undefined : createModelRouter(deps.modelRouting, deps.logger);
  }

  get webSearchProvider(): IWebSearchProvider | undefined {
    return this.deps.webSearchProvider;
  }

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
  }): Promise<HarnessSandbox | undefined> {
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
   * Also closes each RemoteMCP. SSE keeps a GET open after the turn is done,
   * and dropping the object waits for that GET to time out. Model clients are
   * created per request on the process-wide model fetch pool, so this does not
   * close them.
   *
   * Subclasses that acquire additional resources MUST override, release
   * their own resources best-effort, and call `await super.close()`.
   * Idempotent; never throws.
   */
  async close(): Promise<void> {
    const sources = [...this.#sources.values()];
    this.#sources.clear();
    await Promise.all(
      sources.map(async sourcePromise => {
        const source = await sourcePromise.catch(() => undefined);
        if (source instanceof RemoteMCP) {
          await source.close().catch(() => undefined);
        }
      }),
    );
    const sandbox = this.#sandbox;
    this.#sandbox = undefined;
    await sandbox?.close().catch(() => {
      /* no-op */
    });
  }

  /**
   * Default: maps the spec directly to a definition — spec.mcp_servers carry
   * names only; deps.mcp resolves each name to a {@link McpConnection}, and the result
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
            const connection = await this.deps.mcp(entry.name);
            if (connection === undefined) {
              throw new Error(`Unknown MCP server "${entry.name}" — not configured`);
            }
            return new RemoteMCP({
              id: entry.name,
              connection,
              sessionId: previousTurn?.snapshot.mcp_servers?.[entry.name]?.session_id,
              requestTimeoutMs: this.deps.mcpRequestTimeoutMs,
              connectTimeoutMs: this.deps.mcpConnectTimeoutMs,
              ...(this.deps.mcpMaxResponseBytes !== undefined
                ? { maxResponseBytes: this.deps.mcpMaxResponseBytes }
                : {}),
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
          approvalPolicies: previousTurn?.snapshot.mcp_servers?.[entry.name]?.approval_policies,
        });
      }),
    );
    const trueforgeToolSet = await this.trueforgeToolSet({
      signal,
      tracing,
      approvalPolicies: previousTurn?.snapshot.mcp_servers?.[TRUEFORGE_MCP_ID]?.approval_policies,
    });
    const extraCapabilities = [
      ...(trueforgeToolSet === undefined ? [] : [{ systemToolSets: [trueforgeToolSet] }]),
      ...(agentInfo === undefined ? (this.deps.rootCapabilities?.() ?? []) : []),
    ];
    return {
      definition: {
        // Sub-agents receive the delegated task as a user message; their system
        // prompt is SUB_AGENT_IDENTITY (added by AgentThread), not user instructions.
        instruction: agentInfo ? undefined : spec.instructions,
        messages: agentInfo
          ? [{ role: 'user' as const, content: agentInfo.input }]
          : spec.messages?.map(m => ({ role: 'user' as const, content: m.content })),
        // Sub-agents should return free-form summaries to the parent, not the user-facing structured response.
        responseFormat: agentInfo ? undefined : spec.response_format,
        iterationLimit: spec.config.iteration_limit,
        toolSets,
      },
      ...(extraCapabilities.length === 0 ? {} : { extraCapabilities }),
    };
  }

  async resolveModel(input: {
    spec: AgentSpec;
    agent_info: AgentInfo | undefined;
    model: ModelSnapshot | undefined;
    route: RouteInput | undefined;
  }): Promise<AgentModel> {
    const { spec, agent_info } = input;
    if (spec.model.name !== AUTO_MODEL) {
      return this.loadModel({ spec, agent_info, model: agent_info === undefined ? undefined : input.model });
    }
    if (this.routeModel === undefined) {
      throw new AgentHarnessError('auto_model_unavailable', 'Auto mode is turned off for this tenant');
    }
    if (input.model !== undefined) {
      return this.loadModel({ spec, agent_info, model: input.model });
    }
    if (input.route === undefined) {
      throw new Error('Unreachable: an auto thread has neither a chosen model nor a conversation to route on');
    }
    const routed = await this.routeModel(input.route);
    if (routed === undefined) {
      throw new AgentHarnessError('auto_model_unavailable', 'Auto model selection could not choose a model');
    }
    return this.loadModel({ spec, agent_info, model: { name: routed.model, effort: routed.effort } });
  }

  private async loadModel(input: {
    spec: AgentSpec;
    agent_info: AgentInfo | undefined;
    model: ModelSnapshot | undefined;
  }): Promise<AgentModel> {
    const { spec } = input;
    const modelName = input.model?.name ?? input.agent_info?.model ?? spec.model.name;
    const resolvedModel = await this.getModel(modelName);
    // The spec's params belong to its own model; another model runs on its defaults.
    // A routed or saved snapshot replaces that effort, including an explicit none.
    const baseParams =
      modelName === spec.model.name
        ? { ...resolvedModel.defaultModelParams, ...spec.model.params }
        : { ...resolvedModel.defaultModelParams };
    return {
      client: resolvedModel.modelClient,
      name: modelName,
      ...(resolvedModel.providerType !== undefined ? { providerType: resolvedModel.providerType } : {}),
      properties: resolvedModel.modelProperties,
      params: applySavedEffort(baseParams, input.model?.effort),
    };
  }

  private async trueforgeToolSet(input: {
    signal: AbortSignal;
    tracing: AgentTracing;
    approvalPolicies: Record<string, ToolApprovalPolicy> | undefined;
  }): Promise<ToolSet | undefined> {
    const connection = await this.deps.mcp(TRUEFORGE_MCP_ID);
    if (connection === undefined) {
      return undefined;
    }
    const source = await this.getOrCreateToolSource({
      id: TRUEFORGE_MCP_ID,
      create: () =>
        Promise.resolve(
          new RemoteMCP({
            id: TRUEFORGE_MCP_ID,
            connection,
            requestTimeoutMs: this.deps.mcpRequestTimeoutMs,
            connectTimeoutMs: this.deps.mcpConnectTimeoutMs,
            ...(this.deps.mcpMaxResponseBytes !== undefined ? { maxResponseBytes: this.deps.mcpMaxResponseBytes } : {}),
            logger: this.deps.logger,
            tracing: input.tracing,
            signal: input.signal,
            isSystem: true,
          }),
        ),
    });
    return new ToolSet({
      source,
      selectors: TRUEFORGE_MCP_SELECTORS,
      preload: false,
      approvalPolicies: input.approvalPolicies,
    });
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

  /**
   * Resolves `deps.llm` once per distinct model name for this turn — parent and
   * sub-agents with the same catalog model share one promise.
   */
  protected getModel(modelName: string): Promise<ResolvedModel> {
    const cached = this.#models.get(modelName);
    if (cached) {
      return cached;
    }
    const made = this.deps.llm(modelName);
    this.#models.set(modelName, made);
    return made;
  }
}
