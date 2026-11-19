import { CreateTurnRequestSchema, TurnSchema } from '../../../src/agent-session/schemas/turn';

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

describe('TurnSchema', () => {
  it('accepts historical empty-string user message content on persisted input', () => {
    expect(
      TurnSchema.safeParse({
        id: 'turn_1',
        session_id: 'session_1',
        previous_turn_id: null,
        input: [{ type: 'user.message', content: '' }],
        state: { status: 'running' },
        created_at: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
