import { SessionRepositorySchema } from '../../src/agent-session/schemas/session';

describe('SessionRepositorySchema', () => {
  const repository = {
    url: 'https://github.com/example/repository.git',
    ref: 'feature/work',
    path: 'workspace/repository',
    access: 'read_write',
    credential_provider_ref: 'github-app:installation-123',
  };

  it('accepts a scoped HTTPS checkout', () => {
    expect(SessionRepositorySchema.parse(repository)).toEqual(repository);
  });

  it('defaults to anonymous credentials for public repositories', () => {
    const { credential_provider_ref: _credentialProviderRef, ...publicRepository } = repository;
    expect(SessionRepositorySchema.parse(publicRepository).credential_provider_ref).toBeNull();
    expect(
      SessionRepositorySchema.parse({ ...repository, credential_provider_ref: null }).credential_provider_ref,
    ).toBeNull();
  });

  it.each([
    ['non-HTTPS URL', { ...repository, url: 'ssh://git@github.com/example/repository.git' }],
    ['URL credentials', { ...repository, url: 'https://token@github.com/example/repository.git' }],
    ['absolute path', { ...repository, path: '/workspace/repository' }],
    ['sandbox root path', { ...repository, path: '.' }],
    ['traversing path', { ...repository, path: '../repository' }],
    ['empty credential provider reference', { ...repository, credential_provider_ref: '' }],
    ['option-like ref', { ...repository, ref: '--upload-pack=malicious' }],
  ])('rejects %s', (_label, candidate) => {
    expect(SessionRepositorySchema.safeParse(candidate).success).toBe(false);
  });
});
