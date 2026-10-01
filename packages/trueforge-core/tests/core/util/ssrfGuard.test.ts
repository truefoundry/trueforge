import http from 'node:http';
import {
  assertSafeOutboundUrl,
  configureOutboundUrlGuard,
  DEFAULT_OUTBOUND_HTTP_REQUEST_CONNECT_TIMEOUT_MS,
  DEFAULT_OUTBOUND_HTTP_REQUEST_HEADERS_TIMEOUT_MS,
  DEFAULT_OUTBOUND_HTTP_REQUEST_MAX_RETRIES,
  isRetryableOutboundGatewayStatus,
  isRetryableOutboundTransportError,
  ssrfFetch,
} from '../../../src/core/util/ssrfGuard';

function resetOutboundGuard(): void {
  configureOutboundUrlGuard({
    allowedHosts: [],
    blockedHosts: [],
    headersTimeoutMs: DEFAULT_OUTBOUND_HTTP_REQUEST_HEADERS_TIMEOUT_MS,
    connectTimeoutMs: DEFAULT_OUTBOUND_HTTP_REQUEST_CONNECT_TIMEOUT_MS,
    maxRetries: DEFAULT_OUTBOUND_HTTP_REQUEST_MAX_RETRIES,
  });
}

afterEach(() => {
  resetOutboundGuard();
});

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP listen address');
  }
  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

describe('assertSafeOutboundUrl', () => {
  it('rejects private, loopback, and link-local literals', async () => {
    await expect(assertSafeOutboundUrl('http://10.0.0.1/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://192.168.1.1/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://127.0.0.1:6379/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow(/blocked/);
  });

  it('rejects CGNAT, TEST-NET, multicast, and IPv6 literals', async () => {
    await expect(assertSafeOutboundUrl('http://100.64.0.1/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://192.0.2.1/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://224.0.0.1/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://[::1]/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://[2001:db8::1]/')).rejects.toThrow(/blocked/);
  });

  it('rejects single-label and in-cluster hostnames before DNS', async () => {
    await expect(assertSafeOutboundUrl('http://redis/')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('http://foo.svc.cluster.local/mcp')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('https://metadata.google.internal/')).rejects.toThrow(/blocked/);
  });

  it('rejects non-http(s) and allows public IPv4 and IPv6 literals', async () => {
    await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toThrow(/http and https/);
    await expect(assertSafeOutboundUrl('https://93.184.216.34/')).resolves.toBeUndefined();
    await expect(assertSafeOutboundUrl('https://[2606:4700:4700::1111]/')).resolves.toBeUndefined();
  });

  it('honors allow and block lists', async () => {
    configureOutboundUrlGuard({
      allowedHosts: ['localhost', 'foo.svc.cluster.local'],
      blockedHosts: ['93.184.216.34'],
    });
    await expect(assertSafeOutboundUrl('http://localhost:11434/v1')).resolves.toBeUndefined();
    await expect(assertSafeOutboundUrl('http://foo.svc.cluster.local/mcp')).resolves.toBeUndefined();
    await expect(assertSafeOutboundUrl('https://93.184.216.34/')).rejects.toThrow(/blocked/);
  });

  it('skips the guard when disabled', async () => {
    configureOutboundUrlGuard({ enabled: false, allowedHosts: [], blockedHosts: [] });
    await expect(assertSafeOutboundUrl('http://127.0.0.1:6379/')).resolves.toBeUndefined();
    await expect(assertSafeOutboundUrl('http://redis/')).resolves.toBeUndefined();
  });
});

describe('outbound retry classifiers', () => {
  it('detects undici connect and headers timeout codes through Error.cause', () => {
    const connect = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    });
    const headers = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
    });
    expect(isRetryableOutboundTransportError(connect)).toBe(true);
    expect(isRetryableOutboundTransportError(headers)).toBe(true);
    expect(isRetryableOutboundTransportError(new Error('nope'))).toBe(false);
  });

  it('retries only the configured gateway statuses', () => {
    expect(isRetryableOutboundGatewayStatus(520)).toBe(true);
    expect(isRetryableOutboundGatewayStatus(524)).toBe(true);
    expect(isRetryableOutboundGatewayStatus(530)).toBe(true);
    expect(isRetryableOutboundGatewayStatus(500)).toBe(false);
    expect(isRetryableOutboundGatewayStatus(400)).toBe(false);
  });
});

describe('ssrfFetch', () => {
  it('does not call fetch for a blocked URL', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(ssrfFetch('http://169.254.169.254/')).rejects.toThrow(/blocked/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not follow a redirect onto a private address', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    try {
      await expect(ssrfFetch(`${origin}/`)).rejects.toThrow(/blocked/);
    } finally {
      await closeServer(server);
    }
  });

  it('follows a same-origin redirect when the host is allowed', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    const { server, origin } = await listen((req, res) => {
      if (req.url === '/from') {
        res.writeHead(302, { location: '/to' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    try {
      const response = await ssrfFetch(`${origin}/from`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('ok');
    } finally {
      await closeServer(server);
    }
  });

  it('keeps method, headers, and body from a Request argument', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    const { server, origin } = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            method: req.method,
            authorization: req.headers.authorization ?? null,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
    });
    try {
      const response = await ssrfFetch(
        new Request(`${origin}/echo`, {
          method: 'POST',
          headers: { authorization: 'Bearer t', 'content-type': 'text/plain' },
          body: 'hello',
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        method: 'POST',
        authorization: 'Bearer t',
        body: 'hello',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('retries gateway 520 then returns success', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [], maxRetries: 2 });
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      if (hits === 1) {
        res.writeHead(520, { 'content-type': 'text/plain' });
        res.end('gateway');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    try {
      const response = await ssrfFetch(`${origin}/`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('ok');
      expect(hits).toBe(2);
    } finally {
      await closeServer(server);
    }
  });

  it('does not retry 400 or 500', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [], maxRetries: 2 });
    for (const status of [400, 500]) {
      let hits = 0;
      const { server, origin } = await listen((_req, res) => {
        hits += 1;
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end('nope');
      });
      try {
        const response = await ssrfFetch(`${origin}/`);
        expect(response.status).toBe(status);
        expect(hits).toBe(1);
      } finally {
        await closeServer(server);
      }
    }
  });

  it('stops retrying gateway errors when maxRetries is 0', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [], maxRetries: 0 });
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      res.writeHead(522, { 'content-type': 'text/plain' });
      res.end('down');
    });
    try {
      const response = await ssrfFetch(`${origin}/`);
      expect(response.status).toBe(522);
      expect(hits).toBe(1);
    } finally {
      await closeServer(server);
    }
  });

  it('retries headers timeout then returns success', async () => {
    configureOutboundUrlGuard({
      allowedHosts: ['127.0.0.1'],
      blockedHosts: [],
      headersTimeoutMs: 50,
      maxRetries: 2,
    });
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      if (hits === 1) {
        // Accept the socket but never send headers so undici hits headersTimeout.
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    try {
      const response = await ssrfFetch(`${origin}/`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('ok');
      expect(hits).toBe(2);
    } finally {
      await closeServer(server);
    }
  }, 15_000);

  it('does not continue retries after abort', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [], maxRetries: 3 });
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      res.writeHead(520, { 'content-type': 'text/plain' });
      res.end('gateway');
    });
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(ssrfFetch(`${origin}/`, { signal: controller.signal })).rejects.toThrow();
      expect(hits).toBe(0);
    } finally {
      await closeServer(server);
    }
  });
});
