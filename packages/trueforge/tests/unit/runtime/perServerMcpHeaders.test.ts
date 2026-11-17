import { HTTPException } from 'hono/http-exception';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import type { McpServerRecord } from '../../../src/db/mcpServerStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { parsePerServerMcpHeaders } from '../../../src/runtime/perServerMcpHeaders';

describe('parsePerServerMcpHeaders', () => {
  it('parses a header map per server name', () => {
    const raw = JSON.stringify({ 'github-mcp': { Authorization: 'Bearer user' } });

    expect(parsePerServerMcpHeaders(raw)).toEqual({
      'github-mcp': { Authorization: 'Bearer user' },
    });
  });

  it.each([
    ['not json', 'not-json'],
    ['an array', '[]'],
    ['a scalar', '"nope"'],
    ['a server mapped to a string', JSON.stringify({ 'github-mcp': 'Bearer user' })],
    ['a header mapped to a number', JSON.stringify({ 'github-mcp': { 'x-h': 1 } })],
    ['a nested virtual MCP map', JSON.stringify({ 'virtual-mcp': { serv1: { Authorization: 'Bearer a' } } })],
    ['a managed session header', JSON.stringify({ 'github-mcp': { 'Mcp-Session-Id': 'other' } })],
    ['a managed protocol header', JSON.stringify({ 'github-mcp': { 'mcp-protocol-version': '2025-06-18' } })],
  ])('rejects %s rather than silently dropping the identity it carries', (_case, raw) => {
    expect(() => parsePerServerMcpHeaders(raw)).toThrow(HTTPException);
  });

  it('keeps the parse failure as the cause, so a bad header can be debugged', () => {
    expect(() => parsePerServerMcpHeaders('not-json')).toThrow(
      expect.objectContaining({ cause: expect.any(SyntaxError) }),
    );
  });
});

describe('McpServerWithAuthStore.resolveInvokeHeaders', () => {
  const ossRecord: McpServerRecord = {
    id: 'oauth-mcp',
    tenant_id: 'default',
    name: 'oauth-mcp',
    manifest: {
      type: 'remote',
      name: 'oauth-mcp',
      url: 'https://mcp.example/mcp',
      description: '',
      auth: { type: 'dcr' },
    },
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-16T12:00:00.000Z',
  };

  it('forwards a caller Authorization directly instead of starting the DCR consent flow', async () => {
    const db = createSqliteDb(':memory:');
    const store = new McpServerWithAuthStore({
      store: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      clientName: 'test-client',
      perServerHeaders: { 'oauth-mcp': { Authorization: 'Bearer user', 'x-extra': '1' } },
    });

    const resolve = store.resolveInvokeHeaders({ record: ossRecord, userRef: 'user-1' });
    if (typeof resolve !== 'function') {
      throw new Error('expected a headers resolver');
    }
    await expect(resolve()).resolves.toMatchObject({ headers: { Authorization: 'Bearer user', 'x-extra': '1' } });
    await db.destroy();
  });

  it('merges caller headers over the registered headers under any casing', async () => {
    const db = createSqliteDb(':memory:');
    const store = new McpServerWithAuthStore({
      store: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      clientName: 'test-client',
      perServerHeaders: { 'header-mcp': { 'X-Tenant': 'caller' } },
    });
    const record: McpServerRecord = {
      ...ossRecord,
      name: 'header-mcp',
      manifest: {
        ...ossRecord.manifest,
        name: 'header-mcp',
        auth: { type: 'header', headers: { Authorization: 'Bearer server', 'x-tenant': 'server' } },
      },
    };

    const resolve = store.resolveInvokeHeaders({ record, userRef: 'user-1' });
    if (typeof resolve !== 'function') {
      throw new Error('expected a headers resolver');
    }
    await expect(resolve()).resolves.toEqual({
      headers: { Authorization: 'Bearer server', 'X-Tenant': 'caller' },
    });
    await db.destroy();
  });
});
