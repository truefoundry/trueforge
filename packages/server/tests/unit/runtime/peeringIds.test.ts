import { HTTPException } from 'hono/http-exception';
import { executorFromTurnId, mintPeeredTurnId } from '../../../src/runtime/peeringIds';

describe('turn ids', () => {
  it('decodes back to the owning executor', () => {
    expect(executorFromTurnId(mintPeeredTurnId('abc123'))).toBe('abc123');
  });

  it('rejects ids outside the grammar', () => {
    for (const invalid of ['', '.', 'a.', '.b', 'a.b.c', 'noseparator']) {
      let thrown: unknown;
      try {
        executorFromTurnId(invalid);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HTTPException);
      if (!(thrown instanceof HTTPException)) {
        throw new Error(`expected ${JSON.stringify(invalid)} to be rejected`);
      }
      expect(thrown.status).toBe(400);
    }
  });
});
