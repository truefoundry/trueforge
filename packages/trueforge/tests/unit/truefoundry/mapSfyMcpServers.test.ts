import { ZodError } from 'zod';
import {
  MCP_PROXY_BASE_URL_TEMPLATE,
  mapSfyMcpServers,
  parseSfyMcpServerSummary,
  resolveMcpProxyUrl,
  toTrueFoundryMcpManifest,
  type SfyMcpServerSummary,
} from '../../../src/truefoundry/mapSfyMcpServers';

const BASE_ROW = {
  id: 'mcp-1',
  name: 'github',
  proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/github`,
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-16T12:00:00.000Z',
};

function summary(overrides: Partial<SfyMcpServerSummary> = {}): SfyMcpServerSummary {
  return {
    id: 'mcp-1',
    name: 'github',
    proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/github`,
    description: 'GitHub MCP',
    authType: undefined,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-16T12:00:00.000Z',
    ...overrides,
  };
}

describe('parseSfyMcpServerSummary', () => {
  it('parses a full SFY row and reads oauth2 auth_data', () => {
    expect(
      parseSfyMcpServerSummary({
        ...BASE_ROW,
        manifest: {
          description: 'GitHub tools',
          auth_data: { type: 'oauth2' },
        },
      }),
    ).toEqual({
      id: 'mcp-1',
      name: 'github',
      proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/github`,
      description: 'GitHub tools',
      authType: 'oauth2',
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: '2026-01-16T12:00:00.000Z',
    });
  });

  it('falls back description to name and leaves authType undefined when manifest is omitted', () => {
    const parsed = parseSfyMcpServerSummary(BASE_ROW);
    expect(parsed.description).toBe('github');
    expect(parsed.authType).toBeUndefined();
  });

  it('accepts Date timestamps and normalizes to ISO strings', () => {
    const parsed = parseSfyMcpServerSummary({
      ...BASE_ROW,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    });
    expect(parsed.createdAt).toBe('2026-02-01T00:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('throws ZodError when required timestamps are missing', () => {
    expect(() =>
      parseSfyMcpServerSummary({
        id: 'mcp-1',
        name: 'github',
        proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/github`,
      }),
    ).toThrow(ZodError);
  });

  it('throws ZodError on contract drift', () => {
    expect(() => parseSfyMcpServerSummary({ id: 'mcp-1', name: 'github' })).toThrow(ZodError);
  });
});

describe('mapSfyMcpServers', () => {
  it('maps every row through parseSfyMcpServerSummary', () => {
    expect(mapSfyMcpServers({ rows: [BASE_ROW, { ...BASE_ROW, id: 'mcp-2', name: 'linear' }] })).toHaveLength(2);
  });
});

describe('resolveMcpProxyUrl', () => {
  it('substitutes the gateway base and strips trailing slashes from the base', () => {
    expect(
      resolveMcpProxyUrl({
        proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/github`,
        gatewayBaseURL: 'https://gateway.example/',
      }),
    ).toBe('https://gateway.example/mcp-server/github');
  });

  it('replaces every template occurrence', () => {
    expect(
      resolveMcpProxyUrl({
        proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/a/${MCP_PROXY_BASE_URL_TEMPLATE}/b`,
        gatewayBaseURL: 'https://gw.example',
      }),
    ).toBe('https://gw.example/a/https://gw.example/b');
  });

  it('returns the proxy URL unchanged when the template is absent', () => {
    expect(
      resolveMcpProxyUrl({
        proxyUrl: 'https://already.resolved.example/mcp',
        gatewayBaseURL: 'https://gateway.example',
      }),
    ).toBe('https://already.resolved.example/mcp');
  });
});

describe('toTrueFoundryMcpManifest', () => {
  it('maps oauth2 to wire dcr and resolves the gateway proxy URL', () => {
    expect(
      toTrueFoundryMcpManifest({
        server: summary({ authType: 'oauth2' }),
        gatewayUrl: 'https://gateway.example',
      }),
    ).toEqual({
      type: 'truefoundry',
      name: 'github',
      url: 'https://gateway.example/mcp-server/github',
      description: 'GitHub MCP',
      auth: { type: 'dcr' },
    });
  });

  it('omits auth when SFY auth type is not oauth2', () => {
    expect(
      toTrueFoundryMcpManifest({
        server: summary({ authType: 'api_key' }),
        gatewayUrl: 'https://gateway.example',
      }).auth,
    ).toBeUndefined();
    expect(
      toTrueFoundryMcpManifest({
        server: summary({ authType: undefined }),
        gatewayUrl: 'https://gateway.example',
      }).auth,
    ).toBeUndefined();
  });
});
