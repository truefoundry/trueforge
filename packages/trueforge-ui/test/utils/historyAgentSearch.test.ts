import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  readHistoryAgentSearch,
  updateHistoryAgentSearch,
  writeHistoryAgentSearch,
} from '@/utils/historyAgentSearch.js';

describe('historyAgentSearch', () => {
  it('reads one agent intent and gives Try Agent precedence for malformed input', () => {
    assert.deepEqual(readHistoryAgentSearch('?try_agent_name=Helper'), {
      intent: 'try-agent',
      agentName: 'Helper',
    });
    assert.deepEqual(readHistoryAgentSearch('?history_agent_name=Writer'), {
      intent: 'history',
      agentName: 'Writer',
    });
    assert.deepEqual(readHistoryAgentSearch('?try_agent_name=Helper&history_agent_name=Writer'), {
      intent: 'try-agent',
      agentName: 'Helper',
    });
    assert.equal(readHistoryAgentSearch('?try_agent_name='), null);
  });

  it('writes mutually exclusive keys without dropping host query state', () => {
    const params = new URLSearchParams('theme=dark&history_agent_name=Writer');
    writeHistoryAgentSearch(params, { intent: 'try-agent', agentName: 'Helper' });
    assert.equal(params.toString(), 'theme=dark&try_agent_name=Helper');

    writeHistoryAgentSearch(params, { intent: 'history', agentName: 'Writer' });
    assert.equal(params.toString(), 'theme=dark&history_agent_name=Writer');

    writeHistoryAgentSearch(params, null);
    assert.equal(params.toString(), 'theme=dark');
    assert.equal(
      updateHistoryAgentSearch('?theme=dark', { intent: 'history', agentName: 'Support Agent' }),
      '?theme=dark&history_agent_name=Support+Agent',
    );
  });
});
