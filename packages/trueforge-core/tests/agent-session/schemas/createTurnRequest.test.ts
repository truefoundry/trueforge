import { CreateTurnRequestSchema } from '../../../src/agent-session/schemas/turn';

describe('CreateTurnRequestSchema', () => {
  it('requires a non-empty user message', () => {
    expect(CreateTurnRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateTurnRequestSchema.safeParse({ input: [] }).success).toBe(false);
    expect(CreateTurnRequestSchema.safeParse({ input: [{ type: 'user.message', content: '' }] }).success).toBe(false);
    expect(CreateTurnRequestSchema.safeParse({ input: [{ type: 'user.message', content: 'hello' }] }).success).toBe(
      true,
    );
  });
});
