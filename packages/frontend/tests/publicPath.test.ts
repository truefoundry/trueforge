import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { API_BASE_URL, apiPath, UI_BASE_PATH, uiRouterBasename } from '../src/publicPath';

describe('publicPath (default Vite BASE_URL=/)', () => {
  it('shares one public prefix for UI and API', () => {
    assert.equal(UI_BASE_PATH, '/');
    assert.equal(API_BASE_URL, UI_BASE_PATH);
    assert.equal(uiRouterBasename(), undefined);
  });

  it('apiPath leaves root-absolute API paths unchanged', () => {
    assert.equal(apiPath('/api/v1/auth/login'), '/api/v1/auth/login');
    assert.equal(apiPath('api/v1/auth/logout'), '/api/v1/auth/logout');
  });
});
