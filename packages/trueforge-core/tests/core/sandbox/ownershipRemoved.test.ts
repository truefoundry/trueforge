import * as core from '../../../src/core/index';

describe('sandbox tenant ownership helpers', () => {
  it('no longer exports validateSandboxOwnedByTenant or SandboxTenantMismatchError', () => {
    expect('validateSandboxOwnedByTenant' in core).toBe(false);
    expect('SandboxTenantMismatchError' in core).toBe(false);
  });
});
