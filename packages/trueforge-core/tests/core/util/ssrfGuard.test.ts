import http from 'node:http';
import {
  configureOutboundFetches,
  defaultMcpOutboundFetchOptions,
  defaultModelOutboundFetchOptions,
  defaultOutboundFetchOptions,
  mcpSsrfFetch,
  modelSsrfFetch,
  ssrfFetch,
} from '../../../src/core/util/outboundFetch';
import { assertSafeOutboundUrl, configureOutboundUrlGuard } from '../../../src/core/util/ssrfGuard';

function resetOutbound(): void {
  configureOutboundUrlGuard({ allowedHosts: [], blockedHosts: [] });
  configureOutboundFetches({
    outbound: defaultOutboundFetchOptions(),
    model: defaultModelOutboundFetchOptions(),
    mcp: defaultMcpOutboundFetchOptions(),
  });
}

afterEach(() => {
  resetOutbound();
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

  it('retries gateway 520 then returns success', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: { ...defaultOutboundFetchOptions(), maxRetries: 2 },
      model: defaultModelOutboundFetchOptions(),
      mcp: defaultMcpOutboundFetchOptions(),
    });
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

  it('retries Request POST body after gateway 520 (body is not left consumed)', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: { ...defaultOutboundFetchOptions(), maxRetries: 2 },
      model: defaultModelOutboundFetchOptions(),
      mcp: defaultMcpOutboundFetchOptions(),
    });
    const bodies: string[] = [];
    let hits = 0;
    const { server, origin } = await listen((req, res) => {
      hits += 1;
      const chunks: Buffer[] = [];
      req.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        if (hits === 1) {
          res.writeHead(520, { 'content-type': 'text/plain', 'retry-after-ms': '0' });
          res.end('gateway');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    try {
      const response = await ssrfFetch(
        new Request(`${origin}/echo`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: 'hello-retry',
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('ok');
      expect(hits).toBe(2);
      expect(bodies).toEqual(['hello-retry', 'hello-retry']);
    } finally {
      await closeServer(server);
    }
  });

  it('retries 429 after the server-requested Retry-After delay instead of backoff', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: { ...defaultOutboundFetchOptions(), maxRetries: 2 },
      model: defaultModelOutboundFetchOptions(),
      mcp: defaultMcpOutboundFetchOptions(),
    });
    for (const retryAfter of [{ 'retry-after-ms': '50' }, { 'retry-after': '0' }]) {
      let hits = 0;
      const { server, origin } = await listen((_req, res) => {
        hits += 1;
        if (hits === 1) {
          res.writeHead(429, { 'content-type': 'text/plain', ...retryAfter });
          res.end('slow down');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
      try {
        const started = Date.now();
        const response = await ssrfFetch(`${origin}/`);
        expect(response.status).toBe(200);
        expect(hits).toBe(2);
        // Default backoff is ~1s; a much shorter wait proves Retry-After was used.
        expect(Date.now() - started).toBeLessThan(500);
      } finally {
        await closeServer(server);
      }
    }
  });

  it('falls back to backoff when Retry-After exceeds our cap', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: { ...defaultOutboundFetchOptions(), maxRetries: 2 },
      model: defaultModelOutboundFetchOptions(),
      mcp: defaultMcpOutboundFetchOptions(),
    });
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      if (hits === 1) {
        res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '120' });
        res.end('slow down');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    try {
      const started = Date.now();
      const response = await ssrfFetch(`${origin}/`);
      expect(response.status).toBe(200);
      expect(hits).toBe(2);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      await closeServer(server);
    }
  });

  it('retries headers timeout then returns success', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: {
        ...defaultOutboundFetchOptions(),
        headersTimeoutMs: 50,
        maxRetries: 2,
      },
      model: defaultModelOutboundFetchOptions(),
      mcp: defaultMcpOutboundFetchOptions(),
    });
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      if (hits === 1) {
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

  it('stops retrying when aborted during retry backoff', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: { ...defaultOutboundFetchOptions(), maxRetries: 3 },
      model: defaultModelOutboundFetchOptions(),
      mcp: defaultMcpOutboundFetchOptions(),
    });
    const controller = new AbortController();
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      res.writeHead(520, { 'content-type': 'text/plain' });
      res.end('gateway', () => {
        setTimeout(() => controller.abort(), 50);
      });
    });
    try {
      await expect(ssrfFetch(`${origin}/`, { signal: controller.signal })).rejects.toThrow(/abort/i);
      expect(hits).toBe(1);
    } finally {
      await closeServer(server);
    }
  });
});

describe('modelSsrfFetch', () => {
  it('uses the model Agent, not the generic outbound Agent', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: { ...defaultOutboundFetchOptions(), maxRetries: 0 },
      model: { ...defaultModelOutboundFetchOptions(), maxRetries: 2 },
      mcp: defaultMcpOutboundFetchOptions(),
    });
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
      const response = await modelSsrfFetch(`${origin}/`);
      expect(response.status).toBe(200);
      expect(hits).toBe(2);
      hits = 0;
      const generic = await ssrfFetch(`${origin}/`);
      expect(generic.status).toBe(520);
      expect(hits).toBe(1);
    } finally {
      await closeServer(server);
    }
  });
});

describe('mcpSsrfFetch', () => {
  it('retries statuses where the request was not processed but not 409/520/524', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: defaultOutboundFetchOptions(),
      model: defaultModelOutboundFetchOptions(),
      mcp: { ...defaultMcpOutboundFetchOptions(), maxRetries: 2 },
    });
    let firstStatus = 522;
    let hits = 0;
    const { server, origin } = await listen((_req, res) => {
      hits += 1;
      const status = hits === 1 ? firstStatus : 200;
      res.writeHead(status, { 'content-type': 'text/plain', 'retry-after-ms': '0' });
      res.end(String(status));
    });
    try {
      for (const status of [408, 429, 522]) {
        firstStatus = status;
        hits = 0;
        const retried = await mcpSsrfFetch(`${origin}/`);
        expect(retried.status).toBe(200);
        expect(hits).toBe(2);
      }
      for (const status of [409, 520, 524]) {
        firstStatus = status;
        hits = 0;
        const response = await mcpSsrfFetch(`${origin}/`);
        expect(response.status).toBe(status);
        expect(hits).toBe(1);
      }
    } finally {
      await closeServer(server);
    }
  });

  it('does not retry headers timeouts so long tool POSTs are not replayed', async () => {
    configureOutboundUrlGuard({ allowedHosts: ['127.0.0.1'], blockedHosts: [] });
    configureOutboundFetches({
      outbound: defaultOutboundFetchOptions(),
      model: defaultModelOutboundFetchOptions(),
      mcp: {
        ...defaultMcpOutboundFetchOptions(),
        headersTimeoutMs: 50,
        maxRetries: 2,
      },
    });
    let hits = 0;
    const { server, origin } = await listen((_req, _res) => {
      hits += 1;
    });
    try {
      await expect(mcpSsrfFetch(`${origin}/`)).rejects.toThrow();
      expect(hits).toBe(1);
    } finally {
      await closeServer(server);
    }
  }, 15_000);
});
