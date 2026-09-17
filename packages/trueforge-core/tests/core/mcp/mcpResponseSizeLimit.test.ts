import { withMaxResponseBytes } from '../../../src/core/mcp/remoteMcpClient';

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe('withMaxResponseBytes', () => {
  it('aborts when the body exceeds max', async () => {
    const fetchFn = withMaxResponseBytes(async () => new Response(streamOf(new Uint8Array(80))), 50);
    const response = await fetchFn('https://mcp.example.com', { method: 'POST' });

    await expect(response.arrayBuffer()).rejects.toThrow(/exceeded max 50 bytes/);
  });

  it('passes through a body at or under the max', async () => {
    const fetchFn = withMaxResponseBytes(async () => new Response(streamOf(new Uint8Array(50))), 50);
    const response = await fetchFn('https://mcp.example.com', { method: 'POST' });

    expect((await response.arrayBuffer()).byteLength).toBe(50);
  });

  it('does not cap GET text/event-stream bodies', async () => {
    const fetchFn = withMaxResponseBytes(
      async () => new Response(streamOf(new Uint8Array(80)), { headers: { 'content-type': 'text/event-stream' } }),
      50,
    );
    const response = await fetchFn('https://mcp.example.com', { method: 'GET' });

    expect((await response.arrayBuffer()).byteLength).toBe(80);
  });
});
