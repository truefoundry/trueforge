import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { clearApiErrors, getApiErrorsSnapshot, installApiErrorInterceptor, subscribeApiErrors } from './apiErrors';

let stubbedResponse: () => Response | Promise<Response>;

globalThis.fetch = () => Promise.resolve(stubbedResponse());
installApiErrorInterceptor();

describe('api error interceptor', () => {
  beforeEach(() => {
    clearApiErrors();
  });

  it('records failed responses with status and body, and keeps the body readable', async () => {
    stubbedResponse = () =>
      new Response(JSON.stringify({ message: 'boom' }), { status: 500, statusText: 'Internal Server Error' });
    const response = await fetch('/v1/models', { method: 'POST' });

    const [record] = getApiErrorsSnapshot();
    assert.ok(record);
    assert.equal(record.method, 'POST');
    assert.equal(record.url, '/v1/models');
    assert.equal(record.status, 500);
    assert.equal(record.statusText, 'Internal Server Error');
    assert.equal(record.body, '{"message":"boom"}');
    assert.deepEqual(await response.json(), { message: 'boom' });
  });

  it('ignores successful responses', async () => {
    stubbedResponse = () => new Response('ok', { status: 200 });
    await fetch('/v1/models');
    assert.equal(getApiErrorsSnapshot().length, 0);
  });

  it('records network failures and rethrows', async () => {
    stubbedResponse = () => {
      throw new Error('connection refused');
    };
    await assert.rejects(fetch('/v1/skills'), /connection refused/);

    const [record] = getApiErrorsSnapshot();
    assert.ok(record);
    assert.equal(record.status, undefined);
    assert.equal(record.body, 'connection refused');
  });

  it('notifies subscribers on new errors', async () => {
    let notified = 0;
    const unsubscribe = subscribeApiErrors(() => {
      notified += 1;
    });
    stubbedResponse = () => new Response('nope', { status: 404 });
    await fetch('/missing');
    unsubscribe();
    assert.ok(notified >= 1);
  });
});
