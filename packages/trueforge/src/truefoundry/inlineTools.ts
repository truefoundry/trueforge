import {
  ClientSideTool,
  toolResultResponse,
  type AgentCapability,
  type ToolDefinition,
} from '@truefoundry/trueforge-core/core';
import type { ICapabilitiesStore } from '../db/capabilitiesStore';
import { X_TFG_TOOLS, type InlineTools } from './inlineResources';

/**
 * Closed set of capabilities from `x-tfg-tools`. Fresh tool-set instances on every {@link list}.
 */
export class InlineCapabilitiesStore implements ICapabilitiesStore {
  readonly #tools: InlineTools;

  constructor(input: { inline: InlineTools }) {
    this.#tools = input.inline;
  }

  list(): AgentCapability[] {
    return this.#tools.length === 0 ? [] : [inlineToolsCapability(this.#tools)];
  }
}

export function inlineToolsCapability(tools: InlineTools): AgentCapability {
  return {
    systemToolSets: [new InlineClientSideTools(tools)],
  };
}

class InlineClientSideTools extends ClientSideTool {
  readonly name = X_TFG_TOOLS;
  readonly displayName = 'inlineTools';
  override readonly tracingEnabled = false;
  readonly #tools: ToolDefinition[];

  constructor(tools: InlineTools) {
    super();
    this.#tools = tools.map(tool => ({
      ...tool,
      execute: () =>
        Promise.resolve(
          toolResultResponse({
            text: 'This tool requires client-side execution and cannot be run server-side.',
            isError: true,
          }),
        ),
    }));
  }

  protected getTools(): ToolDefinition[] {
    return this.#tools;
  }
}
