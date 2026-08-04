import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  toHarnessAuth,
  toHarnessManifest,
  toUiAuthPublic,
  toUiCatalogEntry,
  toUiConnector,
  toUiTool,
} from '../src/connectorCatalog';

describe('connectorCatalog mappers', () => {
  it('maps harness auth to UI public auth without secrets', () => {
    assert.deepEqual(toUiAuthPublic(undefined), { type: 'none' });
    assert.deepEqual(toUiAuthPublic({ type: 'dcr' }), { type: 'oauth' });
    assert.deepEqual(toUiAuthPublic({ type: 'header', headers: { Authorization: 'Bearer secret' } }), {
      type: 'apiKey',
      headerName: 'Authorization',
    });
  });

  it('maps UI write auth onto harness dcr/header/omit', () => {
    assert.equal(toHarnessAuth({ type: 'none' }), undefined);
    assert.deepEqual(toHarnessAuth({ type: 'oauth' }), { type: 'dcr' });
    assert.deepEqual(toHarnessAuth({ type: 'apiKey', apiKey: 'sk-test' }), {
      type: 'header',
      headers: { Authorization: 'sk-test' },
    });
    assert.deepEqual(toHarnessAuth({ type: 'apiKey', apiKey: 'tok', headerName: 'X-Api-Key' }), {
      type: 'header',
      headers: { 'X-Api-Key': 'tok' },
    });
  });

  it('rejects apiKey auth without a key', () => {
    assert.throws(() => toHarnessAuth({ type: 'apiKey' }), /API key is required/i);
  });

  it('maps catalog presets using name as id', () => {
    assert.deepEqual(
      toUiCatalogEntry({
        type: 'remote',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'dcr' },
      }),
      {
        id: 'linear',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'oauth' },
      },
    );
  });

  it('maps configured servers and tools for the settings list card', () => {
    assert.deepEqual(
      toUiConnector(
        {
          type: 'remote',
          name: 'deepwiki',
          url: 'https://mcp.deepwiki.com/mcp',
          authStatus: { status: 'authenticated' },
        },
        [toUiTool({ name: 'search' }), toUiTool({})],
      ),
      {
        id: 'deepwiki',
        name: 'deepwiki',
        description: 'https://mcp.deepwiki.com/mcp',
        url: 'https://mcp.deepwiki.com/mcp',
        auth: { type: 'none' },
        authenticated: true,
        tools: [
          { id: 'search', name: 'search' },
          { id: 'tool', name: 'tool' },
        ],
      },
    );
  });

  it('builds upsert manifests from UI create/update requests', () => {
    assert.deepEqual(
      toHarnessManifest({
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'oauth' },
      }),
      {
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'dcr' },
      },
    );
    assert.deepEqual(
      toHarnessManifest({
        name: 'custom-mcp',
        url: 'https://example.com/mcp',
        auth: { type: 'none' },
      }),
      {
        name: 'custom-mcp',
        url: 'https://example.com/mcp',
      },
    );
  });
});
