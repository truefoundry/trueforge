import { FlagMemorySettings } from '../../../src/memory/MemorySettings';
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
        key: 'tfg-acme-trueforge-user-1',
      },
    });
  });

  it('uses the agent scope when the bound agent has memory, with or without UI metadata', () => {
    for (const tfgSource of ['ui', null]) {
      const resolution = resolveMemoryScope(session({ agentId: 'agent-9', agentMemoryEnabled: true, tfgSource }));
      expect(resolution).toMatchObject({ eligible: true, scope: { type: 'agent', key: 'tfg-acme-agent-9-user-1' } });
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

  it('replaces unsafe characters in scope keys', () => {
    expect(memoryScopeKey({ tenantId: 'acme corp', agentKey: 'trueforge', subjectId: 'a@b.com/x' })).toBe(
      'tfg-acme-corp-trueforge-a-b.com-x',
    );
  });
});

describe('FlagMemorySettings', () => {
  it('is off for every tenant when the global flag is off', async () => {
    const settings = new FlagMemorySettings({ enabled: false, tenantAllowlist: [] });
    await expect(settings.isTenantMemoryEnabled('acme')).resolves.toBe(false);
  });

  it('allows every tenant with an empty allowlist, otherwise only listed tenants', async () => {
    await expect(
      new FlagMemorySettings({ enabled: true, tenantAllowlist: [] }).isTenantMemoryEnabled('acme'),
    ).resolves.toBe(true);
    const listed = new FlagMemorySettings({ enabled: true, tenantAllowlist: ['acme'] });
    await expect(listed.isTenantMemoryEnabled('acme')).resolves.toBe(true);
    await expect(listed.isTenantMemoryEnabled('other')).resolves.toBe(false);
  });
});
