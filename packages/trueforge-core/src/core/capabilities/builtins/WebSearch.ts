import dedent from 'dedent';
import { z } from 'zod';
import { InstructionBuilder } from '../../InstructionBuilder';
import { type CallToolResponse, toolResultResponse } from '../../mcp/IMCPServer';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../../mcp/LocalToolMCP';
import type { AgentTracing } from '../../tracing/AgentTracing';
import type { IWebSearchProvider } from '../../web-search/WebSearchProvider';
import type { AgentCapability } from '../AgentCapability';

export const WEB_SEARCH_SERVER_ID = 'web-search';
export const WEB_SEARCH_TOOL_NAME = 'web_search';
export const WEB_FETCH_TOOL_NAME = 'web_fetch';
export const WEB_SEARCH_REMINDER_TAG = 'web-search';

const webSearchInputSchema = z
  .object({
    search_queries: z
      .array(z.string().min(1))
      .min(1)
      .max(5)
      .describe(
        'Keyword search queries (prefer 3–6 words each; 2–3 queries often beat one long query). Operators such as site:domain, filetype:pdf, intitle:word, -term, and "exact phrase" may work when the backend supports them.',
      ),
    objective: z
      .string()
      .min(1)
      .optional()
      .describe('Natural-language goal for the search. Helps the backend focus hits when provided.'),
  })
  .strict();

const webFetchInputSchema = z
  .object({
    urls: z
      .array(z.url())
      .min(1)
      .max(5)
      .describe('Page URLs to extract (up to 5). Prefer specific hit URLs from web_search.'),
    objective: z
      .string()
      .min(1)
      .optional()
      .describe('Optional goal used to focus extracted excerpts when the page is large.'),
  })
  .strict();

/** What the tool does — param details live on the Zod schema `.describe`s. */
const WEB_SEARCH_TOOL_DESCRIPTION =
  'Search the web. Returns ranked hits with titles, URLs, and snippets. Prefer concise keyword queries; use multiple related queries in one call when useful.';

/** What the tool does — param details live on the Zod schema `.describe`s. */
const WEB_FETCH_TOOL_DESCRIPTION = `Extract page content from URLs as markdown/text (no LLM summarization). Prefer specific hit URLs from ${WEB_SEARCH_TOOL_NAME} when snippets are not enough.`;

/**
 * Cross-tool policy (when / how to combine search + fetch).
 * Per-tool behavior and params stay on tool descriptions / schema describes.
 */
export function buildWebSearchInstruction(builder: InstructionBuilder): void {
  builder.addSection(
    WEB_SEARCH_REMINDER_TAG,
    dedent`
      The Agent has two system tools for live web access: ${WEB_SEARCH_TOOL_NAME} (search) and ${WEB_FETCH_TOOL_NAME} (extract page content).

      When to use them:
      - The user asks to search, browse, verify, look up, or get latest information.
      - Facts may have changed recently (news, prices, laws, schedules, product specs, software APIs/docs, people in roles, rates, scores).
      - The answer needs direct quotes, links, or precise source attribution.
      - A specific page, paper, dataset, or site is referenced and its contents were not provided.

      How to use them:
      - Start with ${WEB_SEARCH_TOOL_NAME} for discovery; follow with ${WEB_FETCH_TOOL_NAME} on the best URLs when snippets are not enough.
      - Prefer primary and authoritative sources.
    `.trim(),
  );
}

export class WebSearchTools extends LocalToolMCP {
  readonly name = WEB_SEARCH_SERVER_ID;
  readonly displayName = 'WebSearch';
  readonly #provider: IWebSearchProvider;

  constructor(options: { provider: IWebSearchProvider; tracing: AgentTracing }) {
    super({ tracing: options.tracing });
    this.#provider = options.provider;
  }

  private tools: ToolDefinition[] = [
    defineTool({
      name: WEB_SEARCH_TOOL_NAME,
      description: WEB_SEARCH_TOOL_DESCRIPTION,
      schema: webSearchInputSchema,
      handler: input => this.runSearch(input),
    }),
    defineTool({
      name: WEB_FETCH_TOOL_NAME,
      description: WEB_FETCH_TOOL_DESCRIPTION,
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

export function webSearch(options: { provider: IWebSearchProvider; tracing: AgentTracing }): AgentCapability {
  return {
    systemToolSets: [new WebSearchTools(options)],
    instructionBuilders: [buildWebSearchInstruction],
  };
}
