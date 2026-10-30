import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { EmptyCapabilitiesStore } from '../../../src/db/capabilitiesStore';
import { parseInlineTools, X_TFG_TOOLS } from '../../../src/truefoundry/inlineResources';
import { InlineCapabilitiesStore, inlineToolsCapability } from '../../../src/truefoundry/inlineTools';

const askUserSecret = {
  name: 'ask_user_secret',
  description: 'Collect a secret and return a tfy-ephemeral-secret:// placeholder for apply_manifest.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      fields: { type: 'array' },
    },
    required: ['question', 'fields'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      secret: { type: 'string' },
    },
  },
  annotations: { readOnlyHint: true },
};

describe('parseInlineTools', () => {
  it('parses tool definitions', () => {
    expect(parseInlineTools(JSON.stringify([askUserSecret]))).toEqual([askUserSecret]);
    expect(parseInlineTools('[]')).toEqual([]);
  });

  it('rejects oversized headers and invalid payloads', () => {
    expect(() => parseInlineTools('x'.repeat(16_001))).toThrow(HTTPException);
    expect(() => parseInlineTools('not-json')).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
    expect(() => parseInlineTools('{}')).toThrow(expect.objectContaining({ cause: expect.any(ZodError) }));
    expect(() => parseInlineTools(JSON.stringify([askUserSecret, askUserSecret]))).toThrow(HTTPException);
    expect(() =>
      parseInlineTools(
        JSON.stringify(Array.from({ length: 17 }, (_, index) => ({ ...askUserSecret, name: `tool_${String(index)}` }))),
      ),
    ).toThrow(HTTPException);
  });
});

describe('inlineToolsCapability', () => {
  it('exposes tools as client-side system tools', async () => {
    const [toolSet] = inlineToolsCapability(parseInlineTools(JSON.stringify([askUserSecret]))).systemToolSets ?? [];
    expect(toolSet?.name).toBe(X_TFG_TOOLS);

    const listed = await toolSet?.listTools();
    expect(listed && 'result' in listed ? listed.result.tools.map(entry => entry.name) : undefined).toEqual([
      'ask_user_secret',
    ]);

    const response = await toolSet?.callTool({ name: 'ask_user_secret', arguments: {} });
    expect(response && 'clientSideToolRequired' in response).toBe(true);
  });
});

describe('capabilities stores', () => {
  it('EmptyCapabilitiesStore mounts nothing', () => {
    expect(new EmptyCapabilitiesStore().list()).toEqual([]);
  });

  it('InlineCapabilitiesStore returns a fresh tool set on every list', () => {
    const store = new InlineCapabilitiesStore({
      inline: parseInlineTools(JSON.stringify([askUserSecret])),
    });
    const first = store.list();
    const second = store.list();
    expect(first[0]?.systemToolSets?.[0]?.name).toBe(X_TFG_TOOLS);
    expect(first[0]?.systemToolSets?.[0]).not.toBe(second[0]?.systemToolSets?.[0]);
  });

  it('InlineCapabilitiesStore mounts nothing for an empty list', () => {
    expect(new InlineCapabilitiesStore({ inline: [] }).list()).toEqual([]);
  });
});
