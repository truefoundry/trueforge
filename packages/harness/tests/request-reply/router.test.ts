import { ReplyError } from '../../src/request-reply/errors';
import { RequestReplyRouter } from '../../src/request-reply/router';

describe('RequestReplyRouter', () => {
  it('dispatches to the registered handler', async () => {
    const router = new RequestReplyRouter();
    router.registerRoute('echo', async request => ({ status: 200, body: { got: request.body } }));

    const reply = await router.dispatchRoute('echo', { body: 'hi' });
    expect(reply).toEqual({ status: 200, body: { got: 'hi' } });
  });

  it('throws on duplicate route registration', () => {
    const router = new RequestReplyRouter();
    router.registerRoute('dup', async () => ({ status: 200, body: {} }));
    expect(() => router.registerRoute('dup', async () => ({ status: 200, body: {} }))).toThrow(/already registered/);
  });

  it('throws ReplyError(500) for an unknown path', async () => {
    const router = new RequestReplyRouter();
    await expect(router.dispatchRoute('missing', { body: null })).rejects.toThrow(ReplyError);
    await expect(router.dispatchRoute('missing', { body: null })).rejects.toMatchObject({ status: 500 });
  });
});
