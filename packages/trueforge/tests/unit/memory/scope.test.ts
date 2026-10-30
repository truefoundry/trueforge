import { createHash } from 'node:crypto';
import { FlagMemorySettings, type MemorySettings } from '../../../src/memory/MemorySettings';
import { memoryScopeKey, resolveMemoryScope, type MemoryScopeSession } from '../../../src/memory/scope';

const SUBJECT = { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'Priya' } as const;

function session(overrides: Partial<MemoryScopeSession>): MemoryScopeSession {
  return {
    tenantId: 'acme',
    createdBySubject: SUBJECT,
    agentId: null,
    agentMemoryEnabled: false,
    tfgSource: 'ui',
    ...overrides,
  };
}

describe('resolveMemoryScope', () => {
  it('uses the default TrueForge scope for UI sessions without an agent', () => {
    expect(resolveMemoryScope(session({}))).toEqual({
      eligible: true,
      scope: {
        type: 'default',
        tenantId: 'acme',
        subjectId: 'user-1',
        displayName: 'Priya',
        agentId: null,
        key: memoryScopeKey({ tenantId: 'acme', agentKey: 'trueforge', subjectId: 'user-1' }),
      },
    });
  });

  it('uses the agent scope when the bound agent has memory, with or without UI metadata', () => {
    for (const tfgSource of ['ui', null]) {
      const resolution = resolveMemoryScope(session({ agentId: 'agent-9', agentMemoryEnabled: true, tfgSource }));
      expect(resolution).toMatchObject({
        eligible: true,
        scope: { type: 'agent', key: memoryScopeKey({ tenantId: 'acme', agentKey: 'agent-9', subjectId: 'user-1' }) },
      });
    }
  });

  it('follows the agent manifest: no memory for sessions on an agent with memory off, even from the UI', () => {
    for (const tfgSource of ['ui', null]) {
      expect(resolveMemoryScope(session({ agentId: 'agent-9', agentMemoryEnabled: false, tfgSource }))).toEqual({
        eligible: false,
        reason: 'agent_disabled',
      });
    }
  });

  it('is not eligible without UI metadata or an agent with memory', () => {
    expect(resolveMemoryScope(session({ tfgSource: null }))).toEqual({
      eligible: false,
      reason: 'not_memory_session',
    });
  });

  it('gives distinct users distinct keys, even when their ids differ only in punctuation', () => {
    const key = (tenantId: string, agentKey: string, subjectId: string) =>
      memoryScopeKey({ tenantId, agentKey, subjectId });
    expect(key('acme', 'trueforge', 'john+x@corp.com')).not.toBe(key('acme', 'trueforge', 'john-x@corp.com'));
    expect(key('a-b', 'c', 'u')).not.toBe(key('a', 'b-c', 'u'));
    expect(key('acme', 'trueforge', 'u')).toBe(key('acme', 'trueforge', 'u'));
  });

  it('is tfg- plus a sha256 hex digest, with no raw ids in it', () => {
    const key = memoryScopeKey({ tenantId: 'acme', agentKey: 'trueforge', subjectId: 'john@corp.com' });
    expect(key).toMatch(/^tfg-[0-9a-f]{64}$/);
    // Pinned so a change to the scheme (which would orphan existing Zep users) is deliberate.
    expect(memoryScopeKey({ tenantId: 'acme', agentKey: 'trueforge', subjectId: 'user-1' })).toBe(
      `tfg-${createHash('sha256').update('["acme","trueforge","user-1"]').digest('hex')}`,
    );
  });
});

describe('FlagMemorySettings', () => {
  it('follows the global flag for every tenant', async () => {
    const off: MemorySettings = new FlagMemorySettings({ enabled: false });
    const on: MemorySettings = new FlagMemorySettings({ enabled: true });
    await expect(off.isTenantMemoryEnabled('acme')).resolves.toBe(false);
    await expect(on.isTenantMemoryEnabled('acme')).resolves.toBe(true);
  });
});
