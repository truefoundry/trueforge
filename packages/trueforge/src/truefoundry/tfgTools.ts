import {
  ClientSideTool,
  defineTool,
  toolResultResponse,
  type AgentCapability,
  type ToolDefinition,
} from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

/** Per-turn tool names. Not stored, so a resume turn must send the header again. */
export const X_TFG_TOOLS = 'x-tfg-tools';

const ASK_USER_SECRET_SERVER_ID = 'ask-user-secret';
export const ASK_USER_SECRET_TOOL_NAME = 'ask_user_secret';

const TfgToolNameSchema = z.enum([ASK_USER_SECRET_TOOL_NAME]);

export type TfgToolName = z.infer<typeof TfgToolNameSchema>;

/** Reject the header outside TrueFoundry mode before parsing, so a bad payload does not hide the mode error. */
export function assertTfgToolsHeaderAllowed(input: { isTrueFoundryMode: boolean }): void {
  if (!input.isTrueFoundryMode) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} requires TrueFoundry mode` });
  }
}

/**
 * Names from `x-tfg-tools` for this turn. Not stored, so a resume must send the header again.
 * Rejects a bad value rather than mounting nothing.
 */
export function parseTfgTools(raw: string): readonly TfgToolName[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} must be a JSON array`, cause: error });
  }
  if (!Array.isArray(decoded)) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} must be a JSON array of tool names` });
  }

  const names: TfgToolName[] = [];
  const seen = new Set<TfgToolName>();
  for (const entry of decoded) {
    if (typeof entry !== 'string') {
      throw new HTTPException(400, { message: `${X_TFG_TOOLS} entries must be tool names` });
    }
    const parsed = TfgToolNameSchema.safeParse(entry);
    if (!parsed.success) {
      throw new HTTPException(400, { message: `${X_TFG_TOOLS} entry "${entry}" is not a supported tool` });
    }
    if (!seen.has(parsed.data)) {
      seen.add(parsed.data);
      names.push(parsed.data);
    }
  }
  return names;
}

const AskUserSecretFieldSchema = z.object({
  key: z.string().describe('Unique identifier for this field, used as the key in the response mapping.'),
  label: z.string().describe('Human-readable label shown to the user for this input field.'),
  required: z.boolean().default(true).describe('Whether the user must provide this field. Defaults to true.'),
});

const askUserSecretInputSchema = z.object({
  question: z.string().describe('A short prompt explaining what secret data is needed and why.'),
  fields: z.array(AskUserSecretFieldSchema).min(1).max(10).describe('The secret fields to collect from the user.'),
});

/** Client stores the secret and returns a `tfy-ephemeral-secret://` placeholder. The value is not sent here. */
export class AskUserSecret extends ClientSideTool {
  readonly name = ASK_USER_SECRET_SERVER_ID;
  readonly displayName = 'AskUserSecret';
  override readonly tracingEnabled = false;

  protected getTools(): ToolDefinition[] {
    return [
      defineTool({
        name: ASK_USER_SECRET_TOOL_NAME,
        description: [
          'Collect secrets from the user via a secure masked form. Returns opaque tfy-ephemeral-secret:// placeholders that only apply_manifest can dereference.',
          '',
          'A secret is a value that grants access: passwords, API keys, tokens, client secrets, private keys, connection strings.',
          'Public metadata (project names, regions, endpoint URLs, display names) is NOT a secret. Use ask_user_question for those.',
          '',
          'Rules:',
          '- Never fabricate placeholder values. Only use exactly what this tool returns.',
          '- Placeholders work ONLY inside apply_manifest. Do not pass them to any other tool.',
          '- Optional fields left blank by the user are omitted from the response.',
          '',
          'Example:',
          'question: "Provide your OAuth credentials for the AWS integration."',
          'fields: [{"key": "client_id", "label": "Client ID", "required": true}, {"key": "client_secret", "label": "Client Secret", "required": true}]',
          '',
          'Response:',
          '{"data": [{"key": "client_id", "placeholder": "tfy-ephemeral-secret://clx9abc123"}, {"key": "client_secret", "placeholder": "tfy-ephemeral-secret://clx9def456"}]}',
          '',
          'Then pass the placeholders to apply_manifest:',
          '{"manifest": {"type": "cloud-integration", "auth_data": {"client_id": "tfy-ephemeral-secret://clx9abc123", "client_secret": "tfy-ephemeral-secret://clx9def456"}}}',
        ].join('\n'),
        schema: askUserSecretInputSchema,
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

export function askUserSecret(): AgentCapability {
  return {
    systemToolSets: [new AskUserSecret()],
  };
}
