import { getTrueForgeAuthMode, TrueForgeAuthMode } from '../config';
import type { AgentCodeSnippets } from '../schemas/agent';
import { pythonNonStreamTemplate, pythonStreamTemplate } from './codesnippet-templates/python';
import { typescriptNonStreamTemplate, typescriptStreamTemplate } from './codesnippet-templates/typescript';

const TYPESCRIPT_ICON = 'https://assets.production.truefoundry.com/typescript.svg';
const PYTHON_ICON = 'https://assets.production.truefoundry.com/python.svg';

function renderSnippetTemplate(
  template: string,
  vars: { agentName: string; baseUrl: string; tokenLine: string },
): string {
  const literals: Record<string, string> = {
    agentName: JSON.stringify(vars.agentName),
    baseUrl: JSON.stringify(vars.baseUrl),
    tokenLine: vars.tokenLine,
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
  const tsVars = {
    agentName: input.agentName,
    baseUrl: input.baseUrl,
    tokenLine: includeToken ? '\n  token: "USER_API_KEY",' : '',
  };
  // Python kwarg (`token=`) vs TS object field (`token:`), including indent.
  const pyVars = {
    ...tsVars,
    tokenLine: includeToken ? '\n    token="USER_API_KEY",' : '',
  };
  return {
    base_url: input.baseUrl,
    snippets: [
      {
        label_name: 'TypeScript',
        language: 'typescript',
        icon: TYPESCRIPT_ICON,
        sample_code: {
          stream: renderSnippetTemplate(typescriptStreamTemplate, tsVars),
          non_stream: renderSnippetTemplate(typescriptNonStreamTemplate, tsVars),
        },
      },
      {
        label_name: 'Python',
        language: 'python',
        icon: PYTHON_ICON,
        sample_code: {
          stream: renderSnippetTemplate(pythonStreamTemplate, pyVars),
          non_stream: renderSnippetTemplate(pythonNonStreamTemplate, pyVars),
        },
      },
    ],
  };
}
