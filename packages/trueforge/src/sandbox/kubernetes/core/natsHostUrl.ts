import { PortForward, type KubeConfig } from '@kubernetes/client-node';
import { DEFAULT_SANDBOX_NATS_WS_PORT } from '@truefoundry/trueforge-core/core';
import { createServer, type Server } from 'node:net';
import { PassThrough } from 'node:stream';
import type { Logger } from 'winston';
import type { SandboxPod } from '../backend/SandboxBackend';

interface ForwardedNatsEndpoint {
  server: Server;
  port: number;
}

/** Resolves the sandbox NATS bridge directly in-cluster or through a local port-forward. */
export class KubernetesNatsHostUrlResolver {
  private readonly kubeConfig: KubeConfig;
  private readonly inCluster: boolean;
  private readonly logger: Logger;
  private readonly endpoints = new Map<string, Promise<ForwardedNatsEndpoint>>();

  constructor(options: { kubeConfig: KubeConfig; inCluster: boolean; logger: Logger }) {
    this.kubeConfig = options.kubeConfig;
    this.inCluster = options.inCluster;
    this.logger = options.logger.child({ module: 'KubernetesNatsHostUrlResolver' });
  }

  resolve = async (pod: SandboxPod): Promise<string> => {
    if (this.inCluster) {
      return `ws://${pod.podIp}:${String(DEFAULT_SANDBOX_NATS_WS_PORT)}`;
    }
    const key = `${pod.target.namespace}/${pod.target.podName}/${pod.podIp}`;
    const endpoint = this.endpoints.get(key);
    const forwarded = endpoint ?? this.openForward({ pod, key });
    if (endpoint === undefined) {
      this.endpoints.set(key, forwarded);
    }
    const value = await forwarded;
    return `ws://127.0.0.1:${String(value.port)}`;
  };

  private async openForward(params: { pod: SandboxPod; key: string }): Promise<ForwardedNatsEndpoint> {
    const server = createServer(socket => {
      const input = new PassThrough();
      const output = new PassThrough();
      const errors = new PassThrough();
      errors.resume();
      socket.pipe(input);
      output.pipe(socket);
      const portForward = new PortForward(this.kubeConfig);
      void portForward
        .portForward(
          params.pod.target.namespace,
          params.pod.target.podName,
          [DEFAULT_SANDBOX_NATS_WS_PORT],
          output,
          errors,
          input,
        )
        .catch((error: unknown) => {
          this.logger.warn('Kubernetes NATS port-forward failed', { error, pod: params.key });
          socket.destroy(error instanceof Error ? error : undefined);
        });
      socket.on('close', () => {
        input.end();
        output.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new Error(`Kubernetes NATS port-forward did not expose a local port for ${params.key}`);
    }
    return { server, port: address.port };
  }

  async close(): Promise<void> {
    const endpoints = await Promise.allSettled(this.endpoints.values());
    for (const endpoint of endpoints) {
      if (endpoint.status === 'fulfilled') {
        endpoint.value.server.close();
      }
    }
    this.endpoints.clear();
  }
}
