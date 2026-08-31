import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { readSessionShareSearch, writeSessionShareSearch } from '@/utils/sessionShareUrl.js';

describe('sessionShareUrl', () => {
  it('reads agent and session ids from the query string', () => {
    assert.deepEqual(readSessionShareSearch('?sessionId=sess-1&agentId=agent-1'), {
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });
    assert.deepEqual(readSessionShareSearch(''), { sessionId: null, agentId: null });
  });

  it('writes and clears share params without dropping host query keys', () => {
    const params = new URLSearchParams('theme=dark');
    writeSessionShareSearch(params, { sessionId: 'sess-1', agentId: 'agent-1' });
    assert.equal(params.get('theme'), 'dark');
    assert.equal(params.get('sessionId'), 'sess-1');
    writeSessionShareSearch(params, { sessionId: null });
    assert.equal(params.get('sessionId'), null);
    assert.equal(params.get('agentId'), 'agent-1');
  });
});
