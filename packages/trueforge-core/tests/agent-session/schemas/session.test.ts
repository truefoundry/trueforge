import { SessionMetadataSchema } from '../../../src/agent-session/schemas/session';

describe('SessionMetadataSchema keys', () => {
  it.each([['env'], ['Team'], ['a'], ['9start'], ['app.name'], ['tf:tenant'], ['foo_bar'], ['a-b'], ['k'.repeat(32)]])(
    'accepts key %j',
    key => {
      expect(SessionMetadataSchema.parse({ [key]: 'v' })).toEqual({ [key]: 'v' });
    },
  );

  it.each([
    ['_leading'],
    ['.dotstart'],
    [':colon'],
    ['-dash'],
    ['has space'],
    ['env[prod]'],
    ['a/b'],
    ['a$b'],
    [''],
    ['k'.repeat(33)],
  ])('rejects key %j', key => {
    expect(SessionMetadataSchema.safeParse({ [key]: 'v' }).success).toBe(false);
  });
});
