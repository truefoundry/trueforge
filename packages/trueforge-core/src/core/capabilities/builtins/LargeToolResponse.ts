import dedent from 'dedent';
import type { Logger } from 'winston';
import { describeContentSize, estimateTokensForString } from '../../llm/usage';
import type { ToolCallResult } from '../../mcp/executeToolCalls';
import { getOperationMetrics } from '../../observability/operationMetrics';
import { DEFERRED_TOOLS_SERVER_ID, GET_TOOL_INFO_NAME } from '../../runtime/DeferredTool';
import type { CurrentContextUsage } from '../../runtime/contextUsage';
import type { HarnessSandbox, SandboxInfo } from '../../sandbox/Sandbox';
import { createSandboxLargeToolResponseGuidance, SANDBOX_SCHEMA_INFER_TAG } from '../../sandbox/Sandbox';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { AgentCapability } from '../AgentCapability';
import type { AgentThreadExecutionContext } from '../AgentContextProcessor';
import type { ToolResponseProcessor, ToolResponseProcessorResult } from '../ToolResponseProcessor';
import { DEFAULT_CONTEXT_COMPACTION_RATIO } from './ContextCompaction';
import { createDynamicSubAgentLargeToolResponseGuidance } from './DynamicSubAgents';

export const DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD = 6000;
export const DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD = 10000;
export const DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS = 100;
/** Upper bound for elevated tools; effective limit is min(this, 80% of remaining context characters). */
const ELEVATED_TOOL_CHARACTER_LIMIT_CAP = 50_000;
const ELEVATED_TOOLS: ReadonlySet<string> = new Set([GET_TOOL_INFO_NAME]);
const FAILURE_MESSAGE_TRUNCATION_LENGTH = 500;

type ResultCategory = 'failure' | 'sandbox' | 'mcp';

interface ToolResultWithInfo {
  toolCallResult: ToolCallResult;
  originalContent: string;
  originalTokens: number;
  category: ResultCategory;
}

function categorize(result: ToolCallResult, sandbox: HarnessSandbox | undefined): ResultCategory {
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

function remainingContextCharacters(params: {
  modelContextLength: number | undefined;
  currentContextUsage: CurrentContextUsage;
}): number | undefined {
  if (params.modelContextLength === undefined) {
    return undefined;
  }
  const used = params.currentContextUsage.prompt_tokens + params.currentContextUsage.completion_tokens;
  return Math.max(0, (params.modelContextLength - used) * 4);
}

function elevatedCharacterLimit(remainingChars: number | undefined): number {
  if (remainingChars === undefined) {
    return ELEVATED_TOOL_CHARACTER_LIMIT_CAP;
  }
  // Match compaction's 80% trigger so elevated tools leave headroom for summarization.
  return Math.min(ELEVATED_TOOL_CHARACTER_LIMIT_CAP, Math.floor(remainingChars * DEFAULT_CONTEXT_COMPACTION_RATIO));
}

function isWithinElevatedCharacterLimit(entry: ToolResultWithInfo, limit: number): boolean {
  const info = entry.toolCallResult.info;
  // Name alone is not enough: a preloaded remote MCP tool can also be called get_tool_info.
  if (info?.toolSet.name !== DEFERRED_TOOLS_SERVER_ID) {
    return false;
  }
  return ELEVATED_TOOLS.has(info.originalToolName) && entry.originalContent.length <= limit;
}

export class LargeToolResponseProcessor implements ToolResponseProcessor {
  private dynamicSubAgentsPresent: boolean;
  private individualTokenThreshold: number;
  private totalTokenThreshold: number;
  private previewNumberOfCharacters: number;
  private modelContextLength: number | undefined;
  private readonly logger: Logger;

  constructor(param: {
    dynamicSubAgentsPresent: boolean;
    individualTokenThreshold: number;
    totalTokenThreshold: number;
    previewNumberOfCharacters: number;
    modelContextLength: number | undefined;
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
    this.modelContextLength = param.modelContextLength;
    this.logger = param.logger.child({ module: 'LargeToolResponse' });
  }

  // Thresholds are configured in tokens, estimated at 4 characters per token; state them in characters for the model.
  private individualResponseCharacterLimit(): string {
    return String(this.individualTokenThreshold * 4);
  }

  // Strict `>` so a response at the stated character cap (threshold * 4) is allowed, matching guidance.
  private blockReasonDescription(entry: ToolResultWithInfo): string {
    const perResponse = this.individualResponseCharacterLimit();
    const combined = String(this.totalTokenThreshold * 4);
    return entry.originalTokens > this.individualTokenThreshold
      ? `this exceeds the ${perResponse}-character tool call response limit`
      : `the parallel tool call responses together exceed the ${combined}-character combined tool call response limit`;
  }

  private formatBlockedContentPreamble(entry: ToolResultWithInfo): string {
    return `Content too big (${describeContentSize(entry.originalContent)}; ${this.blockReasonDescription(entry)})`;
  }

  private formatPreview(preview: string): string {
    return `Preview (first and last ${String(this.previewNumberOfCharacters)} chars):\n${preview}`;
  }

  private createLargeToolResponseGuidance(sandbox: HarnessSandbox | undefined, entry: ToolResultWithInfo): string {
    const steps = ['It MUST check whether a parameter can reduce the output size.'];

    if (sandbox) {
      steps.push(createSandboxLargeToolResponseGuidance());
    }

    if (this.dynamicSubAgentsPresent) {
      steps.push(createDynamicSubAgentLargeToolResponseGuidance());
    }

    return `${this.formatBlockedContentPreamble(entry)}. To handle a large tool call it MUST do the following:\n${steps
      .map((step, index) => `${String(index + 1)}. ${step}`)
      .join('\n')}`;
  }

  private createFileDumpMessage(params: { filePath: string; preview: string; entry: ToolResultWithInfo }): string {
    const { filePath, preview, entry } = params;
    const charCap = this.individualResponseCharacterLimit();
    const steps: string[] = [
      dedent`It MUST use the sandbox to read or extract from the file.
      It MUST use ${SANDBOX_SCHEMA_INFER_TAG} to understand the schema.
      Each sandbox tool response MUST stay under the ${charCap}-character tool call response limit.
      It MUST prefer one read or extract that returns only what it needs; it MAY use up to ${charCap} character limit when useful.`,
    ];

    if (this.dynamicSubAgentsPresent) {
      steps.push(
        `${createDynamicSubAgentLargeToolResponseGuidance()} It MUST pass the file path to the sub-agent also.`,
      );
    }

    const guidance = `To handle a large tool call it MUST do the following:\n${steps
      .map((step, index) => `${String(index + 1)}. ${step}`)
      .join('\n')}`;

    return `${this.formatBlockedContentPreamble(entry)}. Result saved to: ${filePath}.\n\n${guidance}\n\n${this.formatPreview(preview)}`;
  }

  private buildResultsWithInfo(params: {
    results: ToolCallResult[];
    sandbox: HarnessSandbox | undefined;
    elevatedLimit: number;
  }): ToolResultWithInfo[] {
    const { results, sandbox, elevatedLimit } = params;
    const out: ToolResultWithInfo[] = [];
    for (const toolCallResult of results) {
      const entry: ToolResultWithInfo = {
        toolCallResult,
        originalContent: toolCallResult.message.content,
        originalTokens: estimateTokensForString(toolCallResult.message.content),
        category: categorize(toolCallResult, sandbox),
      };
      if (isWithinElevatedCharacterLimit(entry, elevatedLimit)) {
        continue;
      }
      out.push(entry);
    }
    return out;
  }

  private blockResult(
    entry: ToolResultWithInfo,
    pendingSandboxDumps: ToolResultWithInfo[],
    sandbox: HarnessSandbox | undefined,
    limit: 'large_tool_response_individual' | 'large_tool_response_total',
  ): number {
    getOperationMetrics()?.recordHarnessLimit({ limit });
    const preview = createContentPreview(entry.originalContent, this.previewNumberOfCharacters);

    let newContent: string;
    switch (entry.category) {
      case 'failure':
        newContent = entry.originalContent.slice(0, FAILURE_MESSAGE_TRUNCATION_LENGTH);
        break;
      case 'sandbox':
        newContent = `${this.formatBlockedContentPreamble(entry)}. It MUST write the full output to a file, then return only what it needs. Each tool call response MUST stay under the ${this.individualResponseCharacterLimit()} character tool call response limit. It MAY use grep and sed on the file as needed.\n\n${this.formatPreview(preview)}`;
        break;
      case 'mcp':
        newContent = `${this.createLargeToolResponseGuidance(sandbox, entry)}\n\n${this.formatPreview(preview)}`;
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
    sandbox: HarnessSandbox,
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
      entry.toolCallResult.message.content = this.createFileDumpMessage({
        filePath: stored.filePath,
        preview,
        entry,
      });
      entry.toolCallResult.isStructuredContent = false;
      return stored.sandboxCreated;
    } catch (error) {
      this.logger.error('Failed to upload to sandbox', {
        ...extractErrorLogFields(error),
        reportable_error: { error },
      });
      return undefined;
    }
  }

  private async executeSandboxDumps(
    entries: ToolResultWithInfo[],
    sandbox: HarnessSandbox,
  ): Promise<SandboxInfo | undefined> {
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
    const elevatedLimit = elevatedCharacterLimit(
      remainingContextCharacters({
        modelContextLength: this.modelContextLength,
        currentContextUsage: execution.currentContextUsage,
      }),
    );
    const resultsWithInfo = this.buildResultsWithInfo({ results, sandbox, elevatedLimit });
    let runningTotal = resultsWithInfo.reduce((sum, e) => sum + e.originalTokens, 0);

    if (runningTotal <= this.individualTokenThreshold) {
      return {};
    }

    const pendingSandboxDumps: ToolResultWithInfo[] = [];

    const unblocked: ToolResultWithInfo[] = [];
    for (const entry of resultsWithInfo) {
      if (entry.originalTokens > this.individualTokenThreshold) {
        runningTotal -= this.blockResult(entry, pendingSandboxDumps, sandbox, 'large_tool_response_individual');
      } else {
        unblocked.push(entry);
      }
    }

    const sortedUnblocked = [...unblocked].sort((a, b) => b.originalTokens - a.originalTokens);
    for (const entry of sortedUnblocked) {
      if (runningTotal < this.totalTokenThreshold) {
        break;
      }
      runningTotal -= this.blockResult(entry, pendingSandboxDumps, sandbox, 'large_tool_response_total');
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
  modelContextLength?: number | undefined;
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
        modelContextLength: options.modelContextLength,
        logger: options.logger,
      }),
    ],
  };
}
