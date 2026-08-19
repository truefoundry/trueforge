import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { AgentToolSchema } from './IMCPServer';
import {
  DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS,
  isToolAllowed,
  literalToolNames,
  selectorsIncludeAll,
  toolMatchesAnySelector,
  toolRequiresApproval,
} from './toolSelectors';

/**
 * Per-server tool selectors. Enable/disable/preload tags: `@all`, `@read-only`.
 * Approval tags: `@all`, `@write`, `@destructive`.
 */
export interface ToolSelectorConfig {
  enableTools: string[];
  disableTools: string[];
  preloadTools: string[];
  requireApprovalForTools?: string[] | undefined;
}

/**
 * Encapsulates enable/disable/preload/approval selector policy for a single MCP server. Pure: it
 * never throws or does IO — callers decide how to surface a disallowed/missing tool so each can
 * raise its own error type.
 */
export class ToolSelectorPolicy {
  readonly preload: boolean;
  readonly hasPreloadedTools: boolean;

  private readonly enableTools: string[];
  private readonly disableTools: string[];
  private readonly preloadTools: string[];
  private readonly requireApprovalForTools: string[];
  // Tool names that survived enable/disable filtering on the most recent filterAndAnnotate() call.
  // Used by the sandbox allow-list and as the fast path for callTool gating.
  private resolvedAllowedToolNames: string[] | undefined;

  constructor(params: { selectors: ToolSelectorConfig; preload: boolean }) {
    this.enableTools = params.selectors.enableTools;
    this.disableTools = params.selectors.disableTools;
    this.preloadTools = params.selectors.preloadTools;
    this.requireApprovalForTools = params.selectors.requireApprovalForTools ?? DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS;
    this.preload = params.preload;
    this.hasPreloadedTools = params.preload || this.preloadTools.length > 0;
  }

  /** Literal enable_tools names that are not present on the server (caller throws if non-empty). */
  missingEnableLiterals(tools: AgentToolSchema[]): string[] {
    const availableNames = new Set(tools.map(t => t.name));
    return literalToolNames(this.enableTools).filter(name => !availableNames.has(name));
  }

  /** Filter by enable/disable, record the resolved allow-list, and annotate per-tool preload. */
  filterAndAnnotate(tools: AgentToolSchema[]): AgentToolSchema[] {
    const filtered = tools.filter(tool =>
      isToolAllowed({
        toolName: tool.name,
        annotations: tool.annotations,
        enableSelectors: this.enableTools,
        disableSelectors: this.disableTools,
      }),
    );
    this.resolvedAllowedToolNames = filtered.map(t => t.name);
    return filtered.map(tool => ({ ...tool, preload: this.isToolPreloaded(tool.name, tool.annotations) }));
  }

  private isToolPreloaded(toolName: string, annotations: ToolAnnotations | undefined): boolean {
    // Fully-preloaded server: every allowed tool is loaded into context.
    if (this.preload) {
      return true;
    }
    // Otherwise only the tools matching `preload_tools` stay eager.
    return toolMatchesAnySelector(toolName, annotations, this.preloadTools);
  }

  /**
   * Whether a tool may be called. Uses the resolved allow-list once listTools() has run; before that
   * falls back to matching against the raw selectors, resolving annotations lazily only when needed.
   */
  async isAllowed(toolName: string, resolveAnnotations: () => Promise<ToolAnnotations | undefined>): Promise<boolean> {
    if (this.resolvedAllowedToolNames) {
      return this.resolvedAllowedToolNames.includes(toolName);
    }
    return isToolAllowed({
      toolName,
      annotations: await resolveAnnotations(),
      enableSelectors: this.enableTools,
      disableSelectors: this.disableTools,
    });
  }

  /**
   * Best-effort allow-list for the sandbox. After a listTools() call returns the concrete names;
   * before that, `@all` with no disables means "unrestricted" (undefined), else the literal names.
   */
  allowedNamesForSandbox(): string[] | undefined {
    if (this.resolvedAllowedToolNames) {
      return this.resolvedAllowedToolNames;
    }
    if (selectorsIncludeAll(this.enableTools) && this.disableTools.length === 0) {
      return undefined;
    }
    return literalToolNames(this.enableTools);
  }

  /**
   * Whether the tool requires human approval. Honors `requireApprovalForTools` exactly: omit /
   * undefined defaults to write+destructive (constructor); an explicit list — including empty —
   * is exact.
   */
  requiresApproval(toolName: string, annotations: ToolAnnotations | undefined): boolean {
    return toolRequiresApproval(toolName, annotations, this.requireApprovalForTools);
  }
}
