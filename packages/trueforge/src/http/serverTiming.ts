import type { MiddlewareHandler } from 'hono';

/**
 * How long this process spent before the response was ready to send.
 *
 * Chrome's Network timing panel reads `Server-Timing` and shows it under Server Timing.
 * "Waiting for server response" also includes VPN and other network delay, so the gap
 * between that wait and `server` is time spent outside this process.
 *
 * Streaming responses report time until the response starts (the server side of
 * time-to-first-byte), not how long the stream stayed open.
 */
export function createServerTimingMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      const durationMs = performance.now() - started;
      // `Timing-Allow-Origin` is what lets DevTools show this metric when the page
      // and the API are different origins (a local UI talking to a remote server).
      c.header('Timing-Allow-Origin', '*');
      c.header('Server-Timing', `server;dur=${durationMs.toFixed(1)}`);
    }
  };
}
