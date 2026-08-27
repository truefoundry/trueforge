import type { AgentCodeSnippets } from '../schemas/agent';
import { typescriptNonStreamTemplate, typescriptStreamTemplate } from './codesnippet-templates/typescript';

const TYPESCRIPT_ICON = 'https://assets.production.truefoundry.com/typescript.svg';

function renderSnippetTemplate(template: string, vars: { agentName: string; baseUrl: string }): string {
  const literals: Record<string, string> = {
    agentName: JSON.stringify(vars.agentName),
    baseUrl: JSON.stringify(vars.baseUrl),
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
  return {
    base_url: input.baseUrl,
    snippets: [
      {
        label_name: 'TypeScript',
        language: 'typescript',
        icon: TYPESCRIPT_ICON,
        sample_code: {
          stream: renderSnippetTemplate(typescriptStreamTemplate, input),
          non_stream: renderSnippetTemplate(typescriptNonStreamTemplate, input),
        },
      },
    ],
  };
}
