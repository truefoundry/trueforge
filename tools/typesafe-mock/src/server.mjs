import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';

import { evaluate } from './evaluate.mjs';
import { INVALID_JSON_BODY, MODEL_LIST, authenticate, validateSystemOne } from './errors.mjs';

const MAX_BODY_BYTES = 8_000_000;

function requestId() {
  return `req_${randomBytes(16).toString('hex')}`;
}

function headerValue(headers, name) {
  const value = headers[name];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function send(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-typesafe-request-id': requestId(),
    ...extraHeaders,
  });
  res.end(payload);
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      return { ok: false };
    }
    chunks.push(buffer);
  }
  return { ok: true, raw: Buffer.concat(chunks).toString('utf8') };
}

function forcedStatus(config, headers) {
  const header = headerValue(headers, 'x-typesafe-mock-status');
  if (header === '429' || header === '529') {
    return Number(header);
  }
  return config.forceStatus;
}

function sendOverloaded(res, status) {
  const message = status === 429 ? 'You have exceeded your rate limit.' : 'TypeSafe is temporarily overloaded.';
  send(
    res,
    status,
    { detail: { error_type: status === 429 ? 'rate_limit_error' : 'overloaded_error', message } },
    { 'retry-after': '1', 'retry-after-ms': '1000' },
  );
}

async function handleSystemOne(req, res, config) {
  const body = await readRawBody(req);
  if (!body.ok) {
    send(res, 422, {
      detail: [{ type: 'too_long', loc: ['body'], msg: 'Request body exceeds 8000000 bytes', input: null }],
    });
    return;
  }

  if (body.raw.length > 0) {
    try {
      JSON.parse(body.raw);
    } catch {
      send(res, 422, INVALID_JSON_BODY);
      return;
    }
  }

  const auth = authenticate({ authorization: headerValue(req.headers, 'authorization'), apiKey: config.apiKey });
  if (!auth.ok) {
    send(res, auth.status, auth.body);
    return;
  }

  const overload = forcedStatus(config, req.headers);
  if (overload !== null) {
    sendOverloaded(res, overload);
    return;
  }

  if (body.raw.length === 0) {
    send(res, 422, { detail: [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }] });
    return;
  }

  const parsed = JSON.parse(body.raw);
  const validated = validateSystemOne(parsed);
  if (!validated.ok) {
    send(res, 422, { detail: validated.errors });
    return;
  }

  send(res, 200, evaluate(validated.request));
}

function handleModels(req, res, config) {
  const auth = authenticate({ authorization: headerValue(req.headers, 'authorization'), apiKey: config.apiKey });
  if (!auth.ok) {
    send(res, auth.status, auth.body);
    return;
  }
  const overload = forcedStatus(config, req.headers);
  if (overload !== null) {
    sendOverloaded(res, overload);
    return;
  }
  send(res, 200, MODEL_LIST);
}

function route(req, res, config) {
  const pathname = new URL(req.url ?? '/', 'http://mock.local').pathname;
  if (pathname === '/v1/systemone') {
    if (req.method !== 'POST') {
      send(res, 405, { detail: 'Method Not Allowed' }, { allow: 'POST' });
      return;
    }
    return handleSystemOne(req, res, config);
  }
  if (pathname === '/v1/models') {
    if (req.method !== 'GET') {
      send(res, 405, { detail: 'Method Not Allowed' }, { allow: 'GET' });
      return;
    }
    return handleModels(req, res, config);
  }
  send(res, 404, { detail: 'Not Found' });
  return undefined;
}

export function loadConfig(env) {
  const rawKey = env.TYPESAFE_API_KEY;
  const apiKey = typeof rawKey === 'string' && rawKey.trim() !== '' ? rawKey.trim() : null;
  const rawPort = env.TYPESAFE_MOCK_PORT;
  let port = 8787;
  if (typeof rawPort === 'string' && rawPort.trim() !== '') {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`TYPESAFE_MOCK_PORT must be an integer from 0 to 65535, received ${rawPort}`);
    }
  }
  const rawForce = env.TYPESAFE_MOCK_FORCE_STATUS;
  let forceStatus = null;
  if (typeof rawForce === 'string' && rawForce.trim() !== '') {
    if (rawForce !== '429' && rawForce !== '529') {
      throw new Error(`TYPESAFE_MOCK_FORCE_STATUS must be 429 or 529, received ${rawForce}`);
    }
    forceStatus = Number(rawForce);
  }
  const host = typeof env.TYPESAFE_MOCK_HOST === 'string' && env.TYPESAFE_MOCK_HOST.trim() !== '' ? env.TYPESAFE_MOCK_HOST.trim() : '127.0.0.1';
  return { apiKey, port, host, forceStatus };
}

export function startMockServer(config) {
  const server = createServer((req, res) => {
    Promise.resolve(route(req, res, config)).catch(error => {
      console.error('typesafe mock failed to handle a request', error);
      if (!res.headersSent) {
        send(res, 500, { detail: 'Internal Server Error' });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : config.port;
      const hostname = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
      resolve({
        url: `http://${hostname}:${port}`,
        close() {
          return new Promise((closeResolve, closeReject) => {
            server.close(error => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          });
        },
      });
    });
  });
}
