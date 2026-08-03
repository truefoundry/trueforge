import { OpenAPIHono } from '@hono/zod-openapi';
import type { Sessions } from '@truefoundry/utils/agent-session';
import { TurnNotFoundError } from '@truefoundry/utils/agent-session';
import { createLogger } from 'winston';
import { createTurnsRouter } from '../../../src/apis/turns';
import { McpStore } from '../../../src/legacy-registry-store/McpStore';
import { ModelStore } from '../../../src/legacy-registry-store/ModelStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';

describe('turn SSE after session deletion', () => {
  it('warns when the stream ends because the session/turn was removed', async () => {
    const warnings: unknown[] = [];
    const logger = createLogger({ silent: true });
    logger.warn = ((message: unknown) => {
      warnings.push(message);
      return logger;
    }) as typeof logger.warn;

    const sessions = {
      get: () =>
        Promise.resolve({
          record: { last_turn_id: null },
          createTurn: () =>
            Promise.resolve({
              id: 'turn-gone',
              stream: async function* stream() {
                throw new TurnNotFoundError('turn-gone');
              },
            }),
        }),
    } as unknown as Sessions;

    const app = new OpenAPIHono();
    app.route(
      '/',
      createTurnsRouter({
        sessions,
        activeTurns: new ActiveTurnRegistry(),
        modelStore: new ModelStore([]),
        mcpStore: new McpStore([]),
        logger,
      }),
    );

    const response = await app.request('/s1/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    await response.text();

    expect(
      warnings.some(
        message => typeof message === 'string' && message.includes('Turn stream ended after session/turn was removed'),
      ),
    ).toBe(true);
  });
});
