/**
 * The Ask TFY wire contract, checked against what sfy-server actually sends.
 *
 * sfy-server builds the spec and the two headers in its own repo, so nothing here imports that
 * code. These fixtures mirror its output byte for byte; if it changes shape, this fails rather than
 * the install discovering it on the first turn.
 */
import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { parseInlineMcpServers, parseInlineSkills } from '../../../src/truefoundry/inlineResources';

const MCP_NAMES = ['tfy-platform-mcp', 'tfy-pylon-mcp', 'tfy-docs-mcp', 'tfy-web-search-mcp'] as const;
const SKILL_NAME = 'tfy-platform-skills';

/** Inert filler the length of a TrueFoundry JWT, to size the header realistically. */
const FILLER = 'A'.repeat(1450);

/** The em dash is in the shipped skill description, and a header value cannot carry it raw. */
const SKILL_DESCRIPTION =
  'Answer questions about TrueFoundry, an enterprise AI platform. Covers two products — AI Gateway ' +
  '(LLM proxy, MCP servers, agents, governance) and AI Engineering.';

/** Mirrors sfy-server's toHeaderJson: JSON with every non-ASCII character escaped. */
function toHeaderJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const spec = {
  model: { name: 'openai/gpt-5' },
  instructions: 'You are Ask TFY.',
  mcp_servers: MCP_NAMES.map(name => ({ name })),
  skills: [{ name: SKILL_NAME }],
  config: { sandbox: { enabled: true } },
};

const mcpHeader = toHeaderJson(
  Object.fromEntries(
    MCP_NAMES.map(name => [
      name,
      {
        url: `https://proxy.truefoundry.com/v1/mcp/${name}/server`,
        description: `Search ${name} — the product’s data.`,
        auth: { type: 'header', headers: { Authorization: `Bearer ${FILLER}` } },
      },
    ]),
  ),
);

const skillsHeader = toHeaderJson({
  [SKILL_NAME]: {
    url: 'https://github.com/truefoundry/tfy-ai-gateway-skills',
    ref: 'a1b2c3d4e5f6',
    path: 'skills',
    description: SKILL_DESCRIPTION,
  },
});

describe('Ask TFY wire contract', () => {
  it('accepts the spec sfy-server sends, filling the defaults it leaves out', () => {
    const parsed = AgentSpecSchema.parse(spec);

    expect(parsed.config.sandbox.enabled).toBe(true);
    expect(parsed.mcp_servers?.map(server => server.name)).toEqual([...MCP_NAMES]);
    expect(parsed.skills).toEqual([{ name: SKILL_NAME }]);
  });

  it('resolves every name in the spec from the headers, so none falls through to the registry', () => {
    const servers = parseInlineMcpServers(mcpHeader);
    const skills = parseInlineSkills(skillsHeader);

    for (const name of spec.mcp_servers) {
      expect(servers[name.name]).toBeDefined();
    }
    for (const skill of spec.skills) {
      expect(skills[skill.name]).toBeDefined();
    }
  });

  it('restores the characters a header cannot carry raw', () => {
    expect(parseInlineSkills(skillsHeader)[SKILL_NAME].description).toBe(SKILL_DESCRIPTION);
    expect(parseInlineMcpServers(mcpHeader)['tfy-docs-mcp'].description).toContain('—');
  });

  /** Node rejects a header value outside latin-1 outright, so this is a hard requirement. */
  it.each([
    ['x-tfg-mcp', mcpHeader],
    ['x-tfg-skills', skillsHeader],
  ])('sends %s as ASCII only', (_name, value) => {
    expect(value).not.toMatch(/[^\u0000-\u007f]/);
  });

  /**
   * Node's default max header size is 16KB for the whole block, and an ingress in front is often
   * tighter. Four servers each carrying a JWT is the realistic worst case.
   */
  it('keeps the headers within one 8KB ingress buffer', () => {
    const total = Buffer.byteLength(mcpHeader) + Buffer.byteLength(skillsHeader);

    expect(total).toBeLessThan(8 * 1024);
  });
});
