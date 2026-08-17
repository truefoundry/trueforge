import {
  existingSandboxIdForProvider,
  formatSandboxId,
  parseSandboxId,
  rawSandboxId,
} from '../../../src/core/sandbox/sandboxRef';

describe('sandboxRef', () => {
  it('formats v1:type:raw and parses it back (raw may contain colons)', () => {
    const formatted = formatSandboxId({ providerType: 'local', rawId: '/tmp/a:b:c' });
    expect(formatted).toBe('v1:local:/tmp/a:b:c');
    expect(parseSandboxId(formatted)).toEqual({
      kind: 'v1',
      parts: { providerType: 'local', rawId: '/tmp/a:b:c' },
    });
    expect(rawSandboxId(formatted)).toBe('/tmp/a:b:c');
  });

  it('treats missing v1 prefix and malformed v1 ids as legacy', () => {
    expect(parseSandboxId('tenant.uuid')).toEqual({ kind: 'legacy', rawId: 'tenant.uuid' });
    expect(parseSandboxId('v1:')).toEqual({ kind: 'legacy', rawId: 'v1:' });
    expect(parseSandboxId('v1:daytona')).toEqual({ kind: 'legacy', rawId: 'v1:daytona' });
    expect(parseSandboxId('v1:daytona:')).toEqual({ kind: 'legacy', rawId: 'v1:daytona:' });
    expect(rawSandboxId('tenant.uuid')).toBe('tenant.uuid');
  });

  it('carries legacy and same-type v1 ids; drops cross-type v1 ids', () => {
    expect(
      existingSandboxIdForProvider({ existingSandboxId: undefined, currentProviderType: 'local' }),
    ).toBeUndefined();
    expect(existingSandboxIdForProvider({ existingSandboxId: 'tenant.uuid', currentProviderType: 'local' })).toBe(
      'tenant.uuid',
    );
    expect(
      existingSandboxIdForProvider({
        existingSandboxId: 'v1:local:/tmp/s',
        currentProviderType: 'local',
      }),
    ).toBe('v1:local:/tmp/s');
    expect(
      existingSandboxIdForProvider({
        existingSandboxId: 'v1:daytona:abc',
        currentProviderType: 'local',
      }),
    ).toBeUndefined();
  });
});
