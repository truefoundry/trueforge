import { signArtifactContentToken, verifyArtifactContentToken } from '../../../src/artifacts/contentToken';

describe('artifact content tokens', () => {
  it('round-trips a token and rejects a bad signature or an expired one', () => {
    const signed = signArtifactContentToken({
      tenantId: 'default',
      versionId: 'ver-1',
      signingKey: 'test-key',
      now: 1_000,
    });
    expect(verifyArtifactContentToken({ token: signed.token, signingKey: 'test-key', now: 1_000 })).toEqual({
      tenantId: 'default',
      versionId: 'ver-1',
      expiresAtMs: 1_000 + 60 * 60 * 1000,
    });
    expect(verifyArtifactContentToken({ token: signed.token, signingKey: 'other', now: 1_000 })).toBeUndefined();
    expect(
      verifyArtifactContentToken({ token: signed.token, signingKey: 'test-key', now: 1_000 + 60 * 60 * 1000 }),
    ).toBeUndefined();
    expect(verifyArtifactContentToken({ token: 'not-a-token', signingKey: 'test-key' })).toBeUndefined();
  });
});
