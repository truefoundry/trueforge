/**
 * Maps AgentSpec runtime config flags to public harness builtin capabilities.
 * Plan / ask-user-secret stay gateway-side (extraCapabilities on the resolver).
 */
import type { Logger } from 'winston';
import type { IArtifactsProvider } from '../core/artifacts/ArtifactsProvider';
import type { AgentCapability } from '../core/capabilities/AgentCapability';
import { artifacts } from '../core/capabilities/builtins/Artifacts';
import { askUserQuestion } from '../core/capabilities/builtins/AskUserQuestion';
import { contextCompaction } from '../core/capabilities/builtins/ContextCompaction';
import { currentDateTime } from '../core/capabilities/builtins/CurrentDateTime';
import { dynamicSubAgents } from '../core/capabilities/builtins/DynamicSubAgents';
import { largeToolResponse } from '../core/capabilities/builtins/LargeToolResponse';
import { openUI } from '../core/capabilities/builtins/OpenUI';
import { webSearch } from '../core/capabilities/builtins/WebSearch';
import type { HarnessSandbox } from '../core/sandbox/Sandbox';
import type { AgentTracing } from '../core/tracing/AgentTracing';
import type { IWebSearchProvider } from '../core/web-search/WebSearchProvider';
import type { AgentSpec } from './schemas/agentSpec';

export function builtinsFromSpec(input: {
  spec: AgentSpec;
  /** Root thread only — child threads omit interactive builtins. */
  isChild: boolean;
  sandbox: HarnessSandbox | undefined;
  tracing: AgentTracing;
  webSearchProvider: IWebSearchProvider | undefined;
  artifactsProvider: IArtifactsProvider | undefined;
  logger: Logger;
}): AgentCapability[] {
  const { spec, isChild, sandbox, tracing, webSearchProvider, artifactsProvider, logger } = input;
  const config = spec.config;
  const capabilities: AgentCapability[] = [currentDateTime({ tracing })];

  if (config.context_management.compaction.enabled) {
    capabilities.push(
      contextCompaction({
        compactionThresholdTokens: config.context_management.compaction.trigger?.value,
      }),
    );
  }

  if (!isChild && config.ask_user_questions.enabled) {
    capabilities.push(askUserQuestion());
  }

  const dynamicSubAgentsEnabled = config.dynamic_sub_agents.enabled;
  if (!isChild && dynamicSubAgentsEnabled) {
    capabilities.push(
      dynamicSubAgents({
        sandboxAvailable: sandbox !== undefined,
        tracing,
      }),
    );
  }

  if (config.context_management.large_tool_response.enabled) {
    capabilities.push(
      largeToolResponse({
        dynamicSubAgentsPresent: !isChild && dynamicSubAgentsEnabled,
        logger,
      }),
    );
  }

  if (!isChild && config.generative_ui.enabled) {
    capabilities.push(openUI({ preload: false, tracing }));
  }

  if (webSearchProvider && config.web_search.enabled) {
    capabilities.push(webSearch({ provider: webSearchProvider, tracing }));
  }

  if (!isChild && sandbox && artifactsProvider) {
    capabilities.push(artifacts({ provider: artifactsProvider, sandbox, tracing, logger }));
  }

  return capabilities;
}
