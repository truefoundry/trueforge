import dedent from 'dedent';
import type { Logger } from 'winston';
import { estimateTokensForString } from '../../llm/usage';
import type { ToolCallResult } from '../../mcp/executeToolCalls';
import type { Sandbox, SandboxInfo } from '../../sandbox/Sandbox';
import { createSandboxLargeToolResponseGuidance, SANDBOX_SCHEMA_INFER_TAG } from '../../sandbox/Sandbox';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { AgentCapability } from '../AgentCapability';
import type { AgentThreadExecutionContext } from '../AgentContextProcessor';
import type { ToolResponseProcessor, ToolResponseProcessorResult } from '../ToolResponseProcessor';
import { createDynamicSubAgentLargeToolResponseGuidance } from './DynamicSubAgents';

export const DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD = 6000;
export const DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD = 10000;
export const DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS = 100;
const FAILURE_MESSAGE_TRUNCATION_LENGTH = 500;

type ResultCategory = 'failure' | 'sandbox' | 'mcp';

interface ToolResultWithInfo {
  toolCallResult: ToolCallResult;
  originalContent: string;
  originalTokens: number;
  category: ResultCategory;
}

function categorize(result: ToolCallResult, sandbox: Sandbox | undefined): ResultCategory {
  if (result.failure) {
    return 'failure';
  }
  if (!result.info) {
    throw new Error(`Unreachable`);
  }
  if (sandbox && result.info.toolSet === sandbox) {
    return 'sandbox';
  }
  return 'mcp';
}

function createContentPreview(content: string, previewChars: number): string {
  if (content.length <= previewChars * 2) {
    return content;
  }
  return `${content.slice(0, previewChars)}\n...\n${content.slice(-previewChars)}`;
}

export class LargeToolResponseProcessor implements ToolResponseProcessor {
  private dynamicSubAgentsPresent: boolean;
  private individualTokenThreshold: number;
  private totalTokenThreshold: number;
  private previewNumberOfCharacters: number;
  private readonly logger: Logger;

  constructor(param: {
    dynamicSubAgentsPresent: boolean;
    individualTokenThreshold: number;
    totalTokenThreshold: number;
    previewNumberOfCharacters: number;
    logger: Logger;
  }) {
    if (param.individualTokenThreshold > param.totalTokenThreshold) {
      throw new Error(
        `individualTokenThreshold (${String(param.individualTokenThreshold)}) must be <= totalTokenThreshold (${String(param.totalTokenThreshold)})`,
      );
    }
    this.dynamicSubAgentsPresent = param.dynamicSubAgentsPresent;
    this.individualTokenThreshold = param.individualTokenThreshold;
    this.totalTokenThreshold = param.totalTokenThreshold;
    this.previewNumberOfCharacters = param.previewNumberOfCharacters;
    this.logger = param.logger.child({ module: 'LargeToolResponse' });
  }

  private createLargeToolResponseGuidance(sandbox: Sandbox | undefined): string {
    const steps = ['Check if some parameter can be passed in order to reduce the output size.'];

    if (sandbox) {
      steps.push(createSandboxLargeToolResponseGuidance());
    }

    if (this.dynamicSubAgentsPresent) {
      steps.push(createDynamicSubAgentLargeToolResponseGuidance());
    }

    return `Content too big. To handle a large tool call the Agent can do the following:\n${steps
      .map((step, index) => `${String(index + 1)}. ${step}`)
      .join('\n')}`;
  }

  private createFileDumpMessage(params: { filePath: string; preview: string }): string {
    const { filePath, preview } = params;
    const steps: string[] = [
      dedent`Use sandbox to read parts of the file or extract data.
      Use ${SANDBOX_SCHEMA_INFER_TAG} to undertand the schema.`,
    ];

    if (this.dynamicSubAgentsPresent) {
      steps.push(
        `${createDynamicSubAgentLargeToolResponseGuidance()} The Agent must pass file path to sub-agent also.`,
      );
    }

    const guidance = `The Agent can do the following to handle it:\n${steps
      .map((step, index) => `${String(index + 1)}. ${step}`)
      .join('\n')}`;

    return `Content too large. Result saved to: ${filePath}.\n\n${guidance}\n\nPreview (first and last ${String(this.previewNumberOfCharacters)} chars):\n${preview}`;
  }

  private buildResultsWithInfo(results: ToolCallResult[], sandbox: Sandbox | undefined): ToolResultWithInfo[] {
    return results.map(toolCallResult => ({
      toolCallResult,
      originalContent: toolCallResult.message.content,
      originalTokens: estimateTokensForString(toolCallResult.message.content),
      category: categorize(toolCallResult, sandbox),
    }));
  }

  private blockResult(
    entry: ToolResultWithInfo,
    pendingSandboxDumps: ToolResultWithInfo[],
    sandbox: Sandbox | undefined,
  ): number {
    const preview = createContentPreview(entry.originalContent, this.previewNumberOfCharacters);

    let newContent: string;
    switch (entry.category) {
      case 'failure':
        newContent = entry.originalContent.slice(0, FAILURE_MESSAGE_TRUNCATION_LENGTH);
        break;
      case 'sandbox':
        newContent = `Content too big. The Agent should write to a file if required and use grep and sed.\n\nPreview:\n${preview}`;
        break;
      case 'mcp':
        newContent = `${this.createLargeToolResponseGuidance(sandbox)}\n\nPreview (first and last ${String(this.previewNumberOfCharacters)} chars):\n${preview}`;
        if (sandbox) {
          pendingSandboxDumps.push(entry);
        }
        break;
    }

    entry.toolCallResult.message.content = newContent;
    entry.toolCallResult.isStructuredContent = false;
    return Math.max(0, entry.originalTokens - estimateTokensForString(newContent));
  }

  private async uploadToSandboxAndPrependFilePath(
    entry: ToolResultWithInfo,
    index: number,
    sandbox: Sandbox,
  ): Promise<SandboxInfo | undefined> {
    if (!entry.toolCallResult.info) {
      throw new Error(`Unreachable`);
    }
    const sanitizedName = entry.toolCallResult.info.originalToolName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const epoch = Date.now();
    const fileName = `${sanitizedName}_${String(index)}_${String(epoch)}.txt`;
    try {
      const stored = await sandbox.writeArtifact({
        fileName,
        content: Buffer.from(entry.originalContent),
        sourceTool: entry.toolCallResult.info,
      });
      const preview = createContentPreview(entry.originalContent, this.previewNumberOfCharacters);
      entry.toolCallResult.message.content = this.createFileDumpMessage({ filePath: stored.filePath, preview });
      entry.toolCallResult.isStructuredContent = false;
      return stored.sandboxCreated;
    } catch (error) {
      this.logger.error('Failed to upload to sandbox', extractErrorLogFields(error));
      return undefined;
    }
  }

  private async executeSandboxDumps(entries: ToolResultWithInfo[], sandbox: Sandbox): Promise<SandboxInfo | undefined> {
    const results = await Promise.all(
      entries.map((entry, index) => this.uploadToSandboxAndPrependFilePath(entry, index, sandbox)),
    );
    return results.find(r => r !== undefined);
  }

  async process(
    results: ToolCallResult[],
    execution: Readonly<AgentThreadExecutionContext>,
  ): Promise<ToolResponseProcessorResult> {
    const sandbox = execution.sandbox;
    const resultsWithInfo = this.buildResultsWithInfo(results, sandbox);
    let runningTotal = resultsWithInfo.reduce((sum, e) => sum + e.originalTokens, 0);

    if (runningTotal < this.individualTokenThreshold) {
      return {};
    }

    const pendingSandboxDumps: ToolResultWithInfo[] = [];

    const unblocked: ToolResultWithInfo[] = [];
    for (const entry of resultsWithInfo) {
      if (entry.originalTokens >= this.individualTokenThreshold) {
        runningTotal -= this.blockResult(entry, pendingSandboxDumps, sandbox);
      } else {
        unblocked.push(entry);
      }
    }

    const sortedUnblocked = [...unblocked].sort((a, b) => b.originalTokens - a.originalTokens);
    for (const entry of sortedUnblocked) {
      if (runningTotal < this.totalTokenThreshold) {
        break;
      }
      runningTotal -= this.blockResult(entry, pendingSandboxDumps, sandbox);
    }

    const sandboxCreated = sandbox ? await this.executeSandboxDumps(pendingSandboxDumps, sandbox) : undefined;
    return sandboxCreated !== undefined ? { sandboxCreated } : {};
  }
}

export interface LargeToolResponseSettings {
  individualTokenThreshold?: number | undefined;
  totalTokenThreshold?: number | undefined;
  previewNumberOfCharacters?: number | undefined;
}

export function largeToolResponse(options: {
  dynamicSubAgentsPresent: boolean;
  settings?: LargeToolResponseSettings | undefined;
  logger: Logger;
}): AgentCapability {
  return {
    toolResponseProcessors: [
      new LargeToolResponseProcessor({
        dynamicSubAgentsPresent: options.dynamicSubAgentsPresent,
        individualTokenThreshold: options.settings?.individualTokenThreshold ?? DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD,
        totalTokenThreshold: options.settings?.totalTokenThreshold ?? DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD,
        previewNumberOfCharacters: options.settings?.previewNumberOfCharacters ?? DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS,
        logger: options.logger,
      }),
    ],
  };
}
