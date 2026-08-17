import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  toHarnessAuth,
  toHarnessManifest,
  toUiAuthPublic,
  toUiCatalogEntry,
  toUiConnector,
  toUiConnectorFromReadEntry,
  toUiTool,
} from '@/plugins/trueforge-agent-server-adapter/catalogs/connectorCatalog.js';

describe('connectorCatalog mappers', () => {
  it('maps harness auth to UI public auth without secrets', () => {
    assert.deepEqual(toUiAuthPublic(undefined), { type: 'none' });
    assert.deepEqual(toUiAuthPublic({ type: 'dcr' }), { type: 'dcr' });
    assert.deepEqual(toUiAuthPublic({ type: 'header', headers: { Authorization: 'Bearer secret' } }), {
      type: 'header',
      headerName: 'Authorization',
    });
  });

  it('maps UI write auth onto harness dcr/header/omit', () => {
    assert.equal(toHarnessAuth({ type: 'none' }), undefined);
    assert.deepEqual(toHarnessAuth({ type: 'dcr' }), { type: 'dcr' });
    assert.deepEqual(toHarnessAuth({ type: 'header', apiKey: 'sk-test' }), {
      type: 'header',
      headers: { Authorization: 'sk-test' },
    });
    assert.deepEqual(toHarnessAuth({ type: 'header', apiKey: 'tok', headerName: 'X-Api-Key' }), {
      type: 'header',
      headers: { 'X-Api-Key': 'tok' },
    });
  });

  it('rejects header auth without a key', () => {
    assert.throws(() => toHarnessAuth({ type: 'header' }), /API key is required/i);
  });

  it('maps catalog presets using name as id', () => {
    assert.deepEqual(
      toUiCatalogEntry({
        type: 'remote',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        description: 'Linear MCP server.',
        auth: { type: 'dcr' },
      }),
      {
        id: 'linear',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        description: 'Linear MCP server.',
        auth: { type: 'dcr' },
      },
    );
  });

  it('maps configured servers without embedding tools', () => {
    assert.deepEqual(
      toUiConnector({
        name: 'deepwiki',
        manifest: {
          type: 'remote',
          name: 'deepwiki',
          url: 'https://mcp.deepwiki.com/mcp',
          description: 'DeepWiki MCP server.',
        },
        authStatus: { status: 'not_required' },
      }),
      {
        id: 'deepwiki',
        name: 'deepwiki',
        description: 'DeepWiki MCP server.',
        url: 'https://mcp.deepwiki.com/mcp',
        auth: { type: 'none' },
        requiresAuth: false,
        authenticated: true,
      },
    );
  });

  it('maps auth_required vs authenticated for oauth connectors', () => {
    const pending = toUiConnector({
      name: 'linear',
      manifest: {
        type: 'remote',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        description: 'Linear MCP server.',
        auth: { type: 'dcr' },
      },
      authStatus: { status: 'auth_required' },
    });
    assert.equal(pending.authenticated, false);
    assert.equal(pending.requiresAuth, true);

    const connected = toUiConnector({
      name: 'linear',
      manifest: {
        type: 'remote',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        description: 'Linear MCP server.',
        auth: { type: 'dcr' },
      },
      authStatus: { status: 'authenticated' },
    });
    assert.equal(connected.authenticated, true);
    assert.equal(connected.requiresAuth, false);
  });

  it('maps chat read entries from per-user auth_status', () => {
    assert.deepEqual(
      toUiConnectorFromReadEntry({
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'dcr' },
        authStatus: { status: 'auth_required' },
      }),
      {
        id: 'linear',
        name: 'linear',
        description: 'https://mcp.linear.app/mcp',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'dcr' },
        requiresAuth: true,
        authenticated: false,
      },
    );
  });

  it('maps tool rows with description for getToolsByConnectorId', () => {
    assert.deepEqual(toUiTool({ name: 'search', description: 'Find docs' }), {
      id: 'search',
      name: 'search',
      description: 'Find docs',
    });
    assert.deepEqual(toUiTool({ name: 'search' }), {
      id: 'search',
      name: 'search',
      description: '',
    });
    assert.deepEqual(toUiTool({}), { id: 'tool', name: 'tool', description: '' });
  });

  it('builds upsert manifests from UI create/update requests', () => {
    assert.deepEqual(
      toHarnessManifest({
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'dcr' },
      }),
      {
        type: 'remote',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        description: 'linear MCP server',
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
        type: 'remote',
        name: 'custom-mcp',
        url: 'https://example.com/mcp',
        description: 'custom-mcp MCP server',
      },
    );
    assert.deepEqual(
      toHarnessManifest({
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'dcr' },
        description: 'Linear MCP server.',
      }),
      {
        type: 'remote',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        description: 'Linear MCP server.',
        auth: { type: 'dcr' },
      },
    );
    assert.deepEqual(
      toHarnessManifest({
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        auth: { type: 'dcr' },
        description: '   ',
      }),
      {
        type: 'remote',
        name: 'linear',
        url: 'https://mcp.linear.app/mcp',
        description: 'linear MCP server',
        auth: { type: 'dcr' },
      },
    );
  });
});
