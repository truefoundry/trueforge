import { TurnResourceResolver } from '@truefoundry/trueforge-core/agent-session';
import { tfgToolsCapability, type TfgToolDefinition } from './tfgTools';

type TurnResolverDeps = ConstructorParameters<typeof TurnResourceResolver>[0];

/** Root-only mount for `x-tfg-tools`. A child thread passes `agent_info` and does not get the tools. */
export class TrueFoundryTurnResourceResolver extends TurnResourceResolver {
  readonly #tools: readonly TfgToolDefinition[];

  constructor(input: { deps: TurnResolverDeps; tools: readonly TfgToolDefinition[] }) {
    super(input.deps);
    this.#tools = input.tools;
  }

  override async resolveAgentDefinition(input: Parameters<TurnResourceResolver['resolveAgentDefinition']>[0]) {
    const resolved = await super.resolveAgentDefinition(input);
    if (input.agent_info !== undefined || this.#tools.length === 0) {
      return resolved;
    }
    return {
      ...resolved,
      extraCapabilities: [...(resolved.extraCapabilities ?? []), tfgToolsCapability(this.#tools)],
    };
  }
}
