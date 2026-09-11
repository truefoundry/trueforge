import { getTrueForgeAuthMode, TrueForgeAuthMode } from '../config';
import type { AgentCodeSnippets } from '../schemas/agent';
import { typescriptNonStreamTemplate, typescriptStreamTemplate } from './codesnippet-templates/typescript';

const TYPESCRIPT_ICON = 'https://assets.production.truefoundry.com/typescript.svg';

/** Bearer `token` for OIDC / TrueFoundry; omitted in standalone where login is off. */
const TOKEN_LINE = '\n  token: "USER_API_KEY",';

function renderSnippetTemplate(
  template: string,
  vars: { agentName: string; baseUrl: string; includeToken: boolean },
): string {
  const literals: Record<string, string> = {
    agentName: JSON.stringify(vars.agentName),
    baseUrl: JSON.stringify(vars.baseUrl),
    tokenLine: vars.includeToken ? TOKEN_LINE : '',
  };
  return template.replaceAll(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = literals[key];
    if (value === undefined) {
      throw new Error(`Unknown snippet template placeholder ${match}`);
    }
    return value;
  });
}

export function buildAgentCodeSnippets(input: { agentName: string; baseUrl: string }): AgentCodeSnippets {
  const includeToken = getTrueForgeAuthMode() !== TrueForgeAuthMode.Standalone;
  const vars = { ...input, includeToken };
  return {
    base_url: input.baseUrl,
    snippets: [
      {
        label_name: 'TypeScript',
        language: 'typescript',
        icon: TYPESCRIPT_ICON,
        sample_code: {
          stream: renderSnippetTemplate(typescriptStreamTemplate, vars),
          non_stream: renderSnippetTemplate(typescriptNonStreamTemplate, vars),
        },
      },
    ],
  };
}
