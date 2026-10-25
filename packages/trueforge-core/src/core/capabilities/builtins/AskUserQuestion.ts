import { z } from 'zod';
import { ClientSideTool } from '../../mcp/ClientSideTool';
import { toolResultResponse } from '../../mcp/IMCPServer';
import { defineTool, type ToolDefinition } from '../../mcp/LocalToolMCP';
import type { AgentCapability } from '../AgentCapability';
import { OPENUI_SECTION_TAG } from './OpenUI';

const ASK_USER_QUESTION_SERVER_ID = 'ask-user-question';
const ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

const askUserQuestionInputSchema = z.object({
  question: z.string().describe('The question to ask the user.'),
  options: z
    .array(z.string())
    .min(0)
    .max(5)
    .describe(
      '0-5 mutually exclusive choices, each mapping to a distinct outcome. A free-text input is always rendered alongside.',
    ),
});

export class AskUserQuestion extends ClientSideTool {
  readonly name = ASK_USER_QUESTION_SERVER_ID;
  readonly displayName = 'AskUserQuestion';
  override readonly tracingEnabled = false;

  protected getTools(): ToolDefinition[] {
    return [
      defineTool({
        name: ASK_USER_QUESTION_TOOL_NAME,
        description: [
          'Ask the user a question when clarification or a decision is needed before proceeding. Only ask when the answer meaningfully changes what you do next.',
          '',
          'Rules:',
          '- Provide as many options as the question needs (0-5). When you include options, each must be a genuinely distinct, mutually exclusive outcome that meaningfully changes what you do next.',
          `- MUST NOT use <${OPENUI_SECTION_TAG}> for asking the user a question.`,
          '- The user picks exactly one option — multi-select is not available.',
          '- Options must be mutually exclusive. If a valid choice is a combination of other options, include it as a separate option with the combined data.',
          '- Every option must commit the user to a specific outcome. Do not add an option whose purpose is to let the user describe, specify, or type their own answer. Do not add an option like "Other" or "Something else".',
          '- If you have enough context to confidently recommend one option, put it first with the exact suffix " (Recommended)" — no other wording. If no option clearly stands out, mark nothing.',
          '',
          'Example (distinct options):',
          'question: "<your question>"',
          'options: ["<Option A>", "<Option B>", "<Option C>"]',
          '',
          'Example (combined options):',
          'question: "<your question>"',
          'options: ["<Option A>", "<Option B>", "<Option A and B — combined details>"]',
          '',
          'Example (context clearly favors A):',
          'question: "<your question>"',
          'options: ["<Option A> (Recommended)", "<Option B>", "<Option C>"]',
          '',
          'Avoid:',
          'options: ["<Option A>", "<Option B>", "Other"]',
        ].join('\n'),
        schema: askUserQuestionInputSchema,
        handler: () =>
          Promise.resolve(
            toolResultResponse({
              text: 'This tool requires client-side execution and cannot be run server-side.',
              isError: true,
            }),
          ),
      }),
    ];
  }
}

export function askUserQuestion(): AgentCapability {
  return {
    systemToolSets: [new AskUserQuestion()],
  };
}
