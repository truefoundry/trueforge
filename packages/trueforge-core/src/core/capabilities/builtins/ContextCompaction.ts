import { EventType, newEventId } from '../../events/schema';
import type { ILLM, LLMCreateParams } from '../../llm/ILLM';
import type { AgentDefinition } from '../../runtime/AgentDefinition';
import type { ContextMessage } from '../../runtime/AgentThread.types';
import { internalSystemMessage, isInternalSystemMessage, isLLMContextMessage } from '../../runtime/contextUtils';
import type { AgentCapability } from '../AgentCapability';
import type {
  AgentContextProcessorOutput,
  AgentThreadExecutionContext,
  PreLLMAgentContextProcessor,
} from '../AgentContextProcessor';

export const DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 50 * 1000;
export const DEFAULT_CONTEXT_COMPACTION_RATIO = 0.8;

export function resolveCompactionThresholdTokens(input: {
  configuredThresholdTokens: number | undefined;
  modelContextLength: number | undefined;
  modelParams: AgentDefinition['modelParams'];
}): number {
  if (input.configuredThresholdTokens !== undefined) {
    return input.configuredThresholdTokens;
  }
  if (input.modelContextLength !== undefined) {
    const ratioThreshold = Math.floor(input.modelContextLength * DEFAULT_CONTEXT_COMPACTION_RATIO);
    const configuredMaxOutputTokens = input.modelParams?.['max_completion_tokens'] ?? input.modelParams?.['max_tokens'];
    if (
      typeof configuredMaxOutputTokens === 'number' &&
      Number.isFinite(configuredMaxOutputTokens) &&
      configuredMaxOutputTokens >= 0
    ) {
      const inputBudget = Math.floor(input.modelContextLength - configuredMaxOutputTokens);
      if (inputBudget > 0) {
        return Math.min(ratioThreshold, inputBudget);
      }
    }
    // An unusable output reservation must not turn compaction into an always-on loop.
    return ratioThreshold;
  }
  return DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS;
}

// https://platform.openai.com/tokenizer
const PROMPT_TOKENS = 931;
const PROMPT = `
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
  - Errors that you ran into and how you fixed them
  - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
6. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
7. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
8. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]


3. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

4. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

5. All user messages: 
    - [Detailed non tool use user message]
    - [...]

6. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

7. Current Work:
   [Precise description of current work]

8. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response. 

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary. Examples of instructions include:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>

<example>
# Summary instructions
When you are using compact - please focus on test output and code changes. Include file reads verbatim.
</example>
`;

const CONTINUATION_MESSAGE = internalSystemMessage(
  'The above is the summarised context of the work so far. The Agent must not repeat or re-run any work that was already completed. If results were already obtained, the Agent should present them directly.',
);
Object.freeze(CONTINUATION_MESSAGE);
// https://platform.openai.com/tokenizer
const CONTINUATION_MESSAGE_TOKENS = 42;

function formatAssistantContent(
  content: string | ({ type: 'text'; text: string } | { type: 'refusal'; refusal: string })[] | null | undefined,
): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!content) {
    return '';
  }
  return content.map(part => (part.type === 'text' ? part.text : part.refusal)).join('\n');
}

function createSummarizationCandidate(context: ContextMessage[]) {
  let candidate = '';
  let index = -1;
  for (const m of context) {
    index += 1;
    if (isInternalSystemMessage(m)) {
      continue;
    }
    if (!isLLMContextMessage(m)) {
      continue;
    }
    switch (m.role) {
      case 'user':
        if (typeof m.content === 'string') {
          candidate += `<${String(index)}><user>:` + m.content;
        } else {
          const parts: string[] = [];
          for (const p of m.content) {
            if (p.type === 'text') {
              parts.push(p.text);
            } else {
              parts.push(`[user attached a ${p.type} here, no longer available after summarization]`);
            }
          }
          candidate += `<${String(index)}><user>:` + parts.join('\n');
        }
        break;
      case 'tool':
        candidate += `<${String(index)}><tool-response id=${m.tool_call_id}>:` + m.content;
        break;
      case 'assistant':
        for (const block of m.thinking_blocks ?? []) {
          if (block.type === 'thinking') {
            candidate += `<${String(index)}><assistant-thinking>:` + block.thinking;
          }
        }
        candidate += `<${String(index)}><assistant>:` + formatAssistantContent(m.content);
        for (const t of m.tool_calls ?? []) {
          candidate += `<tool-call id=${t.id} name=${t.function.name}>:` + t.function.arguments;
        }
    }
  }
  return candidate;
}

export class ContextCompaction implements PreLLMAgentContextProcessor {
  private modelClient: ILLM;
  private compactionThresholdTokens: number;

  constructor(input: { modelClient: ILLM; compactionThresholdTokens: number }) {
    this.modelClient = input.modelClient;
    this.compactionThresholdTokens = input.compactionThresholdTokens;
  }

  async *processPreLLM(
    execution: Readonly<AgentThreadExecutionContext>,
  ): AsyncGenerator<AgentContextProcessorOutput, void, unknown> {
    const contextTokens = execution.currentContextUsage.prompt_tokens + execution.currentContextUsage.completion_tokens;
    if (contextTokens + PROMPT_TOKENS < this.compactionThresholdTokens) {
      return;
    }

    // Model identity is owned by modelClient — omit OpenAI's required `model` field.
    const body: LLMCreateParams = {
      messages: [
        { role: 'user', content: createSummarizationCandidate(execution.context) },
        { role: 'user', content: PROMPT },
      ],
      stream: false,
    };

    const response = await this.modelClient.createNonStream(body);
    const context: ContextMessage[] = [{ role: 'assistant', content: response.output.content }, CONTINUATION_MESSAGE];

    yield {
      type: EventType.AGENT_CONTEXT_OVERWRITE,
      id: newEventId(),
      created_at: new Date().toISOString(),
      reason: 'compaction',
      context: context,
      current_context_usage: {
        // NOTE(agent): This is not really correct.
        // This is not taking into account that the original request had
        // tool definition in them.
        // This will get refreshed in the next LLM call.
        prompt_tokens: response.usage.input_tokens + CONTINUATION_MESSAGE_TOKENS,
        completion_tokens: 0,
      },
      usage: response.usage,
    };
  }
}

export interface ContextCompactionSettings {
  compactionThresholdTokens?: number | undefined;
}

export function contextCompaction(options: {
  definition: AgentDefinition;
  settings?: ContextCompactionSettings | undefined;
  compactionThresholdTokens?: number | undefined;
}): AgentCapability {
  const threshold = resolveCompactionThresholdTokens({
    configuredThresholdTokens: options.compactionThresholdTokens ?? options.settings?.compactionThresholdTokens,
    modelContextLength: options.definition.modelProperties?.contextLength,
    modelParams: options.definition.modelParams,
  });
  return {
    preLLMProcessors: [
      new ContextCompaction({
        modelClient: options.definition.modelClient,
        compactionThresholdTokens: threshold,
      }),
    ],
  };
}
