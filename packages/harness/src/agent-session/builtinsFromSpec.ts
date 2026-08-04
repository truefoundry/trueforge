/**
 * Maps AgentSpec runtime config flags to public harness builtin capabilities.
 * Plan / ask-user-secret stay gateway-side (extraCapabilities on the resolver).
 */
import type { Logger } from 'winston';
import type { AgentCapability } from '../core/capabilities/AgentCapability';
import { askUserQuestion } from '../core/capabilities/builtins/AskUserQuestion';
import { contextCompaction } from '../core/capabilities/builtins/ContextCompaction';
import { currentDateTime } from '../core/capabilities/builtins/CurrentDateTime';
import { dynamicSubAgents } from '../core/capabilities/builtins/DynamicSubAgents';
import { largeToolResponse } from '../core/capabilities/builtins/LargeToolResponse';
import { openUI } from '../core/capabilities/builtins/OpenUI';
import type { AgentDefinition } from '../core/runtime/AgentDefinition';
import type { AgentTracing } from '../core/tracing/AgentTracing';
import type { AgentSpec } from './schemas/agentSpec';

export function builtinsFromSpec(input: {
  spec: AgentSpec;
  definition: AgentDefinition;
  /** Root thread only — child threads omit interactive builtins. */
  isChild: boolean;
  sandboxAvailable: boolean;
  tracing: AgentTracing;
  logger: Logger;
}): AgentCapability[] {
  const { spec, definition, isChild, sandboxAvailable, tracing, logger } = input;
  const config = spec.config;
  const capabilities: AgentCapability[] = [currentDateTime({ tracing })];

  const compaction = config?.context_management.compaction;
  if (!compaction || compaction.enabled) {
    capabilities.push(
      contextCompaction({
        definition,
        compactionThresholdTokens: compaction?.compaction_threshold_tokens,
      }),
    );
  }

  if (!isChild && (config?.ask_user_questions === undefined || config.ask_user_questions.enabled)) {
    capabilities.push(askUserQuestion());
  }

  const dynamicSubAgentsEnabled = config?.dynamic_sub_agents === undefined || config.dynamic_sub_agents.enabled;
  if (!isChild && dynamicSubAgentsEnabled) {
    capabilities.push(
      dynamicSubAgents({
        sandboxAvailable,
        tracing,
      }),
    );
  }

  const large = config?.context_management.large_tool_response;
  if (!large || large.enabled) {
    capabilities.push(
      largeToolResponse({
        dynamicSubAgentsPresent: !isChild && dynamicSubAgentsEnabled,
        logger,
      }),
    );
  }

  if (!isChild && config?.generative_ui?.enabled) {
    capabilities.push(openUI());
  }

  return capabilities;
}
