/**
 * Node UDS binder for the Code Mode transport contract suite.
 */
import {
  CodeModeDispatcher,
  CodeModeReplySchema,
  type CodeModeReply,
  type CodeModeRequest,
  type IToolSet,
} from '@truefoundry/trueforge-core/core';
import { mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCodeModeTransportContractSuite,
  type CodeModeTransportContractFixture,
} from '../../../../../trueforge-core/tests/core/sandbox/codeMode/codeModeTransportContractSuite';
import { CodeModeUdsTransport } from '../../../../src/sandbox/local/core/CodeModeUdsTransport.js';
import { encodeJsonMessage, JsonMessageReader, MAX_MESSAGE_BYTES } from '../../../../src/sandbox/local/core/frame.js';

function makeSilentLogger() {
  const logger = {
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

function makeDemoToolSet(): IToolSet {
  return {
    name: 'demo',
    id: 'demo',
    preload: true,
    hasPreloadedTools: true,
    listTools: () =>
      Promise.resolve({
        result: {
          tools: [
            {
              name: 'ping',
              description: 'ping',
              inputSchema: { type: 'object' as const, properties: {} },
              preload: true,
            },
          ],
        },
        wasInitialized: undefined,
      }),
    callTool: () =>
      Promise.resolve({
        result: { content: [{ type: 'text' as const, text: 'ok' }], isError: false },
        wasInitialized: undefined,
      }),
    toolCallInfo: () => undefined,
  };
}

function resolveSockPath(env: Record<string, string>): string {
  const sock = env['TFY_MCP_SOCK'];
  if (sock === undefined || sock === '') {
    throw new Error('TFY_MCP_SOCK missing from transport env');
  }
  return sock;
}

function sendUdsRequest(params: { env: Record<string, string>; request: CodeModeRequest }): Promise<CodeModeReply> {
  const path = resolveSockPath(params.env);
  const timeoutSeconds = Number(params.env['TFY_CM_REQUEST_TIMEOUT_SECONDS'] ?? '30');
  const timeoutMs = Number.isFinite(timeoutSeconds) ? timeoutSeconds * 1000 : 30_000;

  return new Promise((resolve, reject) => {
    const socket = createConnection({ path, allowHalfOpen: true });
    const reader = new JsonMessageReader({ maxBytes: MAX_MESSAGE_BYTES });
    let settled = false;

    const finish = (error: Error | undefined, reply?: CodeModeReply): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else if (reply !== undefined) resolve(reply);
      else reject(new Error('missing reply'));
    };

    const timer = setTimeout(() => {
      finish(new Error(`UDS request timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

    socket.on('error', error => {
      finish(error);
    });
    socket.on('data', (chunk: Buffer) => {
      try {
        reader.push(chunk);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on('end', () => {
      try {
        const parsed = CodeModeReplySchema.safeParse(reader.finish());
        if (!parsed.success) {
          finish(new Error('malformed Code Mode reply'));
          return;
        }
        finish(undefined, parsed.data);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on('connect', () => {
      const body = encodeJsonMessage(params.request);
      socket.write(body, writeErr => {
        if (writeErr) {
          finish(writeErr);
          return;
        }
        socket.end();
      });
    });
  });
}

runCodeModeTransportContractSuite(async (): Promise<CodeModeTransportContractFixture> => {
  const codeModeSocketParentPath = join(tmpdir(), 'cm');
  await mkdir(codeModeSocketParentPath, { recursive: true, mode: 0o700 });
  const transport = new CodeModeUdsTransport({
    codeModeSocketParentPath,
    clientRemotePath: sandboxId => join(sandboxId, 'mcp-client', 'mcp_client.py'),
  });
  const dispatcher = new CodeModeDispatcher({
    toolSets: [makeDemoToolSet()],
    logger: makeSilentLogger(),
  });

  return {
    transport,
    dispatcher,
    sandboxId: 'contract-sandbox',
    requestTimeoutSeconds: 30,
    sendRequest: ({ env, request }) => sendUdsRequest({ env, request }),
    dispose: async () => {
      dispatcher.close();
      await transport.stop();
    },
  };
});
