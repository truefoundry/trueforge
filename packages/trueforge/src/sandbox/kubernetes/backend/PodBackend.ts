/** Sandboxes as plain Pods — the fallback when the agent-sandbox CRD is not installed. */
import { ApiException, type V1Pod, type V1PodList, type V1ResourceRequirements } from '@kubernetes/client-node';
import { SandboxNotAvailableError } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import {
  SANDBOX_LABELS,
  SANDBOX_LABEL_SELECTOR,
  SANDBOX_TENANT_ANNOTATION,
  type SandboxBackend,
  type SandboxListEntry,
  type SandboxPod,
} from './SandboxBackend';

/** The container the agent's commands run in. */
export const SANDBOX_CONTAINER_NAME = 'sandbox';

/**
 * Matches the `WORKDIR` of the shipped sandbox image. Writable storage is mounted here so the
 * agent's files survive a container restart within the pod.
 */
export const SANDBOX_WORKING_DIR = '/home/trueforge';

/** Shared with AgentSandboxBackend so both backends mount writable storage the same way. */
export const WORKSPACE_VOLUME_NAME = 'workspace';

/** Waiting reasons that never resolve on their own — surface them instead of waiting out the timeout. */
const FATAL_WAITING_REASONS = new Set([
  'ImagePullBackOff',
  'ErrImagePull',
  'InvalidImageName',
  'CreateContainerConfigError',
  'CreateContainerError',
  'RunContainerError',
]);

/** The pod operations this backend needs; `CoreV1Api` satisfies it. */
export interface PodApi {
  createNamespacedPod(params: { namespace: string; body: V1Pod }): Promise<V1Pod>;
  readNamespacedPod(params: { name: string; namespace: string }): Promise<V1Pod>;
  deleteNamespacedPod(params: { name: string; namespace: string }): Promise<unknown>;
  listNamespacedPod(params: { namespace: string; labelSelector?: string }): Promise<V1PodList>;
}

export interface PodBackendOptions {
  api: PodApi;
  namespace: string;
  image: string;
  serviceAccountName: string | undefined;
  imagePullSecretName: string | undefined;
  resources: V1ResourceRequirements | undefined;
  pollIntervalMs: number;
  logger: Logger;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiException && error.code === 404;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isReady(pod: V1Pod): boolean {
  return pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True') === true;
}

/** A pod that will never run: terminal phase, or a container stuck on a reason that cannot clear. */
function fatalReason(pod: V1Pod): string | undefined {
  const phase = pod.status?.phase;
  if (phase === 'Failed' || phase === 'Succeeded') {
    return [phase, pod.status?.reason, pod.status?.message].filter(part => part !== undefined).join(': ');
  }
  for (const status of pod.status?.containerStatuses ?? []) {
    const waiting = status.state?.waiting;
    if (waiting?.reason !== undefined && FATAL_WAITING_REASONS.has(waiting.reason)) {
      return [waiting.reason, waiting.message].filter(part => part !== undefined).join(': ');
    }
  }
  return undefined;
}

export class PodBackend implements SandboxBackend {
  readonly kind = 'pod';
  private readonly api: PodApi;
  private readonly namespace: string;
  private readonly image: string;
  private readonly serviceAccountName: string | undefined;
  private readonly imagePullSecretName: string | undefined;
  private readonly resources: V1ResourceRequirements | undefined;
  private readonly pollIntervalMs: number;
  private readonly logger: Logger;

  constructor(options: PodBackendOptions) {
    this.api = options.api;
    this.namespace = options.namespace;
    this.image = options.image;
    this.serviceAccountName = options.serviceAccountName;
    this.imagePullSecretName = options.imagePullSecretName;
    this.resources = options.resources;
    this.pollIntervalMs = options.pollIntervalMs;
    this.logger = options.logger.child({ module: 'PodBackend' });
  }

  private podSpec(params: { name: string; tenantId: string }): V1Pod {
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: params.name,
        namespace: this.namespace,
        labels: { ...SANDBOX_LABELS },
        annotations: { [SANDBOX_TENANT_ANNOTATION]: params.tenantId },
      },
      spec: {
        ...(this.serviceAccountName === undefined ? {} : { serviceAccountName: this.serviceAccountName }),
        ...(this.imagePullSecretName === undefined ? {} : { imagePullSecrets: [{ name: this.imagePullSecretName }] }),
        // The image entrypoint supervises NATS; a crash should bring it back, not end the sandbox.
        restartPolicy: 'Always',
        volumes: [{ name: WORKSPACE_VOLUME_NAME, emptyDir: {} }],
        containers: [
          {
            name: SANDBOX_CONTAINER_NAME,
            image: this.image,
            workingDir: SANDBOX_WORKING_DIR,
            volumeMounts: [{ name: WORKSPACE_VOLUME_NAME, mountPath: SANDBOX_WORKING_DIR }],
            ...(this.resources === undefined ? {} : { resources: this.resources }),
          },
        ],
      },
    };
  }

  async create(params: { name: string; tenantId: string }): Promise<void> {
    try {
      await this.api.createNamespacedPod({ namespace: this.namespace, body: this.podSpec(params) });
    } catch (error) {
      throw new Error(`Failed to create sandbox pod ${this.namespace}/${params.name}`, { cause: error });
    }
    this.logger.debug('Created sandbox pod', { namespace: this.namespace, name: params.name });
  }

  private async read(name: string): Promise<V1Pod> {
    try {
      return await this.api.readNamespacedPod({ name, namespace: this.namespace });
    } catch (error) {
      if (isNotFound(error)) {
        throw new SandboxNotAvailableError(`${this.namespace}/${name}`);
      }
      throw new Error(`Failed to read sandbox pod ${this.namespace}/${name}`, { cause: error });
    }
  }

  private toSandboxPod(params: { name: string; pod: V1Pod }): SandboxPod | undefined {
    const podIp = params.pod.status?.podIP;
    if (params.pod.status?.phase !== 'Running' || !isReady(params.pod) || podIp === undefined) {
      return undefined;
    }
    return {
      target: { namespace: this.namespace, podName: params.name, containerName: SANDBOX_CONTAINER_NAME },
      podIp,
    };
  }

  async waitUntilRunning(params: { name: string; timeoutMs: number }): Promise<SandboxPod> {
    const deadline = Date.now() + params.timeoutMs;
    let lastPhase: string | undefined;
    for (;;) {
      const pod = await this.read(params.name);
      const running = this.toSandboxPod({ name: params.name, pod });
      if (running !== undefined) {
        return running;
      }
      const fatal = fatalReason(pod);
      if (fatal !== undefined) {
        throw new Error(`Sandbox pod ${this.namespace}/${params.name} cannot start — ${fatal}`);
      }
      lastPhase = pod.status?.phase;
      if (Date.now() >= deadline) {
        throw new Error(
          `Sandbox pod ${this.namespace}/${params.name} did not become ready within ${String(params.timeoutMs)}ms (phase ${lastPhase ?? 'unknown'})`,
        );
      }
      await delay(this.pollIntervalMs);
    }
  }

  /**
   * Unlike startup polling, a pod that is gone or dead here means the sandbox the caller
   * holds an id for is unusable — a 410, not a start-up failure.
   */
  async getRunningPod(params: { name: string }): Promise<SandboxPod> {
    const pod = await this.read(params.name);
    const running = this.toSandboxPod({ name: params.name, pod });
    if (running === undefined) {
      throw new SandboxNotAvailableError(`${this.namespace}/${params.name}`);
    }
    return running;
  }

  async delete(params: { name: string }): Promise<void> {
    try {
      await this.api.deleteNamespacedPod({ name: params.name, namespace: this.namespace });
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw new Error(`Failed to delete sandbox pod ${this.namespace}/${params.name}`, { cause: error });
    }
  }

  async list(): Promise<readonly SandboxListEntry[]> {
    const pods = await this.api.listNamespacedPod({
      namespace: this.namespace,
      labelSelector: SANDBOX_LABEL_SELECTOR,
    });
    return pods.items
      .flatMap(pod => {
        const name = pod.metadata?.name;
        const createdAt = pod.metadata?.creationTimestamp;
        const tenantId = pod.metadata?.annotations?.[SANDBOX_TENANT_ANNOTATION];
        return name === undefined || createdAt === undefined ? [] : [{ name, createdAt, tenantId }];
      })
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }
}
