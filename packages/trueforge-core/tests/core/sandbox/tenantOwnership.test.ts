import { validateSandboxOwnedByTenant } from '../../../src/core/sandbox/SandboxErrors';

describe('validateSandboxOwnedByTenant', () => {
  it('accepts a Daytona/TFY raw id prefixed with the tenant', () => {
    expect(() =>
      validateSandboxOwnedByTenant({ sandboxId: 'acme.01900000-0000-0000-0000-000000000001', tenantName: 'acme' }),
    ).not.toThrow();
  });

  it('rejects another tenant prefix, a fancy id, and a local path', () => {
    expect(() =>
      validateSandboxOwnedByTenant({ sandboxId: 'other.01900000-0000-0000-0000-000000000001', tenantName: 'acme' }),
    ).toThrow(/does not belong to tenant acme/);
    expect(() =>
      validateSandboxOwnedByTenant({
        sandboxId: 'v1:daytona:acme.01900000-0000-0000-0000-000000000001',
        tenantName: 'acme',
      }),
    ).toThrow(/does not belong to tenant acme/);
    expect(() => validateSandboxOwnedByTenant({ sandboxId: '/var/folders/xx/sandbox', tenantName: 'acme' })).toThrow(
      /does not belong to tenant acme/,
    );
  });
});
