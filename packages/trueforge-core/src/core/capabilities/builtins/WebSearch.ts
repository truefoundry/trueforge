import { z } from 'zod';
import { type CallToolResponse, toolResultResponse } from '../../mcp/IMCPServer';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../../mcp/LocalToolMCP';
import type { AgentTracing } from '../../tracing/AgentTracing';
import type { WebSearchProvider } from '../../web-search/WebSearchProvider';
import type { AgentCapability } from '../AgentCapability';

export const WEB_SEARCH_SERVER_ID = 'web-search';
export const WEB_SEARCH_TOOL_NAME = 'web_search';
export const WEB_FETCH_TOOL_NAME = 'web_fetch';

const webSearchInputSchema = z
  .object({
    search_queries: z
      .array(z.string().min(1))
      .min(1)
      .max(5)
      .describe('Concise keyword search queries (3–6 words each). Provide 2–3 for best results.'),
    objective: z
      .string()
      .min(1)
      .optional()
      .describe('Natural-language goal for the search. Helps focus results when provided.'),
  })
  .strict();

const webFetchInputSchema = z
  .object({
    urls: z.array(z.url()).min(1).max(20).describe('URLs to fetch page content from (up to 20).'),
    objective: z.string().min(1).optional().describe('Optional goal used to focus extracted excerpts.'),
  })
  .strict();

export class WebSearchTools extends LocalToolMCP {
  readonly name = WEB_SEARCH_SERVER_ID;
  readonly displayName = 'WebSearch';
  readonly #provider: WebSearchProvider;

  constructor(options: { provider: WebSearchProvider; tracing: AgentTracing }) {
    super({ tracing: options.tracing });
    this.#provider = options.provider;
  }

  private tools: ToolDefinition[] = [
    defineTool({
      name: WEB_SEARCH_TOOL_NAME,
      description: 'Search the live web and return ranked hits with titles, URLs, and LLM-oriented snippets.',
      schema: webSearchInputSchema,
      handler: input => this.runSearch(input),
    }),
    defineTool({
      name: WEB_FETCH_TOOL_NAME,
      description: 'Fetch and extract page content from one or more URLs as markdown suitable for LLM use.',
      schema: webFetchInputSchema,
      handler: input => this.runFetch(input),
    }),
  ];

  protected getTools(): ToolDefinition[] {
    return this.tools;
  }

  private async runSearch(input: z.infer<typeof webSearchInputSchema>): Promise<CallToolResponse> {
    const result = await this.#provider.search({
      search_queries: input.search_queries,
      objective: input.objective,
    });
    return toolResultResponse({ text: JSON.stringify(result) });
  }

  private async runFetch(input: z.infer<typeof webFetchInputSchema>): Promise<CallToolResponse> {
    const result = await this.#provider.fetch({
      urls: input.urls,
      objective: input.objective,
    });
    return toolResultResponse({ text: JSON.stringify(result) });
  }
}

export function webSearch(options: { provider: WebSearchProvider; tracing: AgentTracing }): AgentCapability {
  return {
    systemToolSets: [new WebSearchTools(options)],
  };
}
