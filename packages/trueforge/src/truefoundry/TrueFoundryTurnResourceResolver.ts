import { TurnResourceResolver } from '@truefoundry/trueforge-core/agent-session';
import { ASK_USER_SECRET_TOOL_NAME, askUserSecret, type TfgToolName } from './tfgTools';

type TurnResolverDeps = ConstructorParameters<typeof TurnResourceResolver>[0];

/** Root-only mount for `x-tfg-tools`. A child thread passes `agent_info` and does not get the tool. */
export class TrueFoundryTurnResourceResolver extends TurnResourceResolver {
  readonly #enabledTools: ReadonlySet<TfgToolName>;

  constructor(input: { deps: TurnResolverDeps; enabledTools: readonly TfgToolName[] }) {
    super(input.deps);
    this.#enabledTools = new Set(input.enabledTools);
  }

  override async resolveAgentDefinition(input: Parameters<TurnResourceResolver['resolveAgentDefinition']>[0]) {
    const resolved = await super.resolveAgentDefinition(input);
    if (input.agent_info !== undefined || !this.#enabledTools.has(ASK_USER_SECRET_TOOL_NAME)) {
      return resolved;
    }
    return {
      ...resolved,
      extraCapabilities: [...(resolved.extraCapabilities ?? []), askUserSecret()],
    };
  }
}
