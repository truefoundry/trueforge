import type { ILLM } from '../llm/ILLM';
import type { ModelParams } from '../llm/model';
import type { VercelAIProviderName } from '../llm/VercelAILLM';
import type { ModelSnapshot } from './AgentThread.types';

/** The model a thread runs on, resolved for that thread. */
export interface AgentModel {
  client: ILLM;
  /** `provider/model`. */
  name: string;
  /** Configured provider. Omitted when the host did not resolve one. */
  providerType?: VercelAIProviderName | undefined;
  properties?:
    | {
        /** Maximum combined input/output context for the resolved model, when known. */
        contextLength: number | undefined;
      }
    | undefined;
  params?: ModelParams | undefined;
}

/** Checkpoint form of a resolved model. Effort is the call's `reasoning_effort`. */
export function modelSnapshotFromAgent(model: AgentModel): ModelSnapshot {
  return {
    name: model.name,
    effort: model.params?.reasoning_effort ?? null,
  };
}
