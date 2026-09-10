// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  IS_CREATE_AGENT_METADATA_KEY,
  isCreateAgentMetadataValue,
  readSessionIsCreateAgent,
  sessionIsCreateAgent,
} from '@/atoms/lib/sessionCreateAgent.js';

describe('sessionCreateAgent', () => {
  it('maps boolean intent to wire string metadata', () => {
    expect(isCreateAgentMetadataValue(true)).toBe('true');
    expect(isCreateAgentMetadataValue(false)).toBe('false');
    expect(IS_CREATE_AGENT_METADATA_KEY).toBe('is_create_agent');
  });

  it('treats missing metadata as false (legacy chat)', () => {
    expect(readSessionIsCreateAgent(undefined)).toBe(false);
    expect(readSessionIsCreateAgent({})).toBe(false);
    expect(readSessionIsCreateAgent({ is_create_agent: 'false' })).toBe(false);
    expect(readSessionIsCreateAgent({ is_create_agent: 'true' })).toBe(true);
  });

  it('reads isCreateAgent from UI session objects', () => {
    expect(sessionIsCreateAgent({ isCreateAgent: true })).toBe(true);
    expect(sessionIsCreateAgent({ isCreateAgent: false })).toBe(false);
    expect(sessionIsCreateAgent({ metadata: { is_create_agent: 'true' } })).toBe(true);
    expect(sessionIsCreateAgent({})).toBe(false);
  });
});
