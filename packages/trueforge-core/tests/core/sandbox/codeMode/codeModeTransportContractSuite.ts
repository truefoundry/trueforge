import type { CodeModeDispatcher } from '../../../../src/core/sandbox/codeMode/CodeModeDispatcher';
import type { CodeModeTransport } from '../../../../src/core/sandbox/codeMode/CodeModeTransport';
import type { CodeModeReply, CodeModeRequest } from '../../../../src/core/sandbox/codeMode/types';

export interface CodeModeTransportContractFixture {
  transport: CodeModeTransport;
  dispatcher: CodeModeDispatcher;
  sandboxId: string;
  requestTimeoutSeconds: number;
  /**
   * Binder-owned client: given env from `start()`, send one Code Mode request and
   * return the decoded reply. Suite never opens UDS/NATS itself.
   */
  sendRequest: (params: { env: Record<string, string>; request: CodeModeRequest }) => Promise<CodeModeReply>;
  dispose: () => Promise<void>;
}

/**
 * Code Mode transport contract suite — factory-injected so UDS (and future) binders can reuse it.
 * Transport-agnostic: does not assert sock paths, NATS subjects, or other channel-specific keys.
 */
export function runCodeModeTransportContractSuite(
  createFixture: () => CodeModeTransportContractFixture | Promise<CodeModeTransportContractFixture>,
): void {
  describe('CodeModeTransport contract', () => {
    let fixture: CodeModeTransportContractFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });

    afterEach(async () => {
      await fixture.dispose();
    });

    it('start succeeds and is idempotent', async () => {
      const first = await fixture.transport.start({
        codeModeDispatcher: fixture.dispatcher,
        sandboxId: fixture.sandboxId,
        requestTimeoutSeconds: fixture.requestTimeoutSeconds,
      });
      expect(typeof first.env).toBe('object');
      expect(first.env).not.toBeNull();

      const second = await fixture.transport.start({
        codeModeDispatcher: fixture.dispatcher,
        sandboxId: fixture.sandboxId,
        requestTimeoutSeconds: fixture.requestTimeoutSeconds,
      });
      expect(typeof second.env).toBe('object');
      expect(second.env).not.toBeNull();
    });

    it('round-trips a list_tools request', async () => {
      const { env } = await fixture.transport.start({
        codeModeDispatcher: fixture.dispatcher,
        sandboxId: fixture.sandboxId,
        requestTimeoutSeconds: fixture.requestTimeoutSeconds,
      });

      const reply = await fixture.sendRequest({
        env,
        request: { op: 'list_tools', server: 'demo' },
      });

      expect(reply.ok).toBe(true);
      if (!reply.ok) {
        throw new Error('unreachable');
      }
      expect(reply.result).toBeDefined();
    });

    it('closed dispatcher returns source transport', async () => {
      const { env } = await fixture.transport.start({
        codeModeDispatcher: fixture.dispatcher,
        sandboxId: fixture.sandboxId,
        requestTimeoutSeconds: fixture.requestTimeoutSeconds,
      });
      fixture.dispatcher.close();

      const reply = await fixture.sendRequest({
        env,
        request: { op: 'list_tools', server: 'demo' },
      });

      expect(reply).toEqual({
        ok: false,
        error: 'Code Mode dispatcher is closed',
        source: 'transport',
      });
    });

    it('stop is safe after start and before start; start after stop still round-trips', async () => {
      await fixture.transport.stop();

      await fixture.transport.start({
        codeModeDispatcher: fixture.dispatcher,
        sandboxId: fixture.sandboxId,
        requestTimeoutSeconds: fixture.requestTimeoutSeconds,
      });
      await fixture.transport.stop();

      const restarted = await fixture.transport.start({
        codeModeDispatcher: fixture.dispatcher,
        sandboxId: fixture.sandboxId,
        requestTimeoutSeconds: fixture.requestTimeoutSeconds,
      });

      const reply = await fixture.sendRequest({
        env: restarted.env,
        request: { op: 'list_tools', server: 'demo' },
      });
      expect(reply.ok).toBe(true);
    });
  });
}
