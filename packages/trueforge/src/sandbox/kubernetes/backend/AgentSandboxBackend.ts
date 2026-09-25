import { ApiException, type V1Pod, type V1ResourceRequirements } from '@kubernetes/client-node';
import { SandboxNotAvailableError } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import { SANDBOX_CONTAINER_NAME, SANDBOX_WORKING_DIR, WORKSPACE_VOLUME_NAME } from './PodBackend';
import {
  SANDBOX_LABELS,
  SANDBOX_LABEL_SELECTOR,
  SANDBOX_TENANT_ANNOTATION,
  type SandboxBackend,
  type SandboxListEntry,
  type SandboxPod,
} from './SandboxBackend';

const AGENT_SANDBOX_GROUP = 'agents.x-k8s.io';
const AGENT_SANDBOX_VERSION = 'v1beta1';
const AGENT_SANDBOX_PLURAL = 'sandboxes';

export interface AgentSandboxApi {
  createNamespacedCustomObject(params: {
    group: string;
    version: string;
    namespace: string;
    plural: string;
    body: Record<string, unknown>;
  }): Promise<unknown>;
  getNamespacedCustomObject(params: {
    group: string;
    version: string;
    namespace: string;
    plural: string;
    name: string;
  }): Promise<Record<string, unknown>>;
  deleteNamespacedCustomObject(params: {
    group: string;
    version: string;
    namespace: string;
    plural: string;
    name: string;
  }): Promise<unknown>;
  listNamespacedCustomObject(params: {
    group: string;
    version: string;
    namespace: string;
    plural: string;
    labelSelector: string;
  }): Promise<{ items?: Record<string, unknown>[] }>;
}

export interface AgentSandboxPodApi {
  readNamespacedPod(params: { name: string; namespace: string }): Promise<V1Pod>;
}

export interface AgentSandboxBackendOptions {
  api: AgentSandboxApi;
  podApi: AgentSandboxPodApi;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readyCondition(resource: Record<string, unknown>): boolean {
  const status = resource['status'];
  if (!isRecord(status)) {
    return false;
  }
  const conditions = status['conditions'];
  if (!Array.isArray(conditions)) {
    return false;
  }
  return conditions.some(condition => {
    if (!isRecord(condition)) {
      return false;
    }
    return condition['type'] === 'Ready' && condition['status'] === 'True';
  });
}

function podReady(pod: V1Pod): boolean {
  return (
    pod.status?.phase === 'Running' &&
    pod.status.podIP !== undefined &&
    pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True') === true
  );
}

function creationDate(resource: Record<string, unknown>): Date | undefined {
  const metadata = resource['metadata'];
  if (!isRecord(metadata)) {
    return undefined;
  }
  const timestamp = metadata['creationTimestamp'];
  if (typeof timestamp !== 'string') {
    return undefined;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Agent Sandbox CR backend; the CR controller owns pod lifecycle and stable identity. */
export class AgentSandboxBackend implements SandboxBackend {
  readonly kind = 'agent-sandbox';
  private readonly api: AgentSandboxApi;
  private readonly podApi: AgentSandboxPodApi;
  private readonly namespace: string;
  private readonly image: string;
  private readonly serviceAccountName: string | undefined;
  private readonly imagePullSecretName: string | undefined;
  private readonly resources: V1ResourceRequirements | undefined;
  private readonly pollIntervalMs: number;
  private readonly logger: Logger;

  constructor(options: AgentSandboxBackendOptions) {
    this.api = options.api;
    this.podApi = options.podApi;
    this.namespace = options.namespace;
    this.image = options.image;
    this.serviceAccountName = options.serviceAccountName;
    this.imagePullSecretName = options.imagePullSecretName;
    this.resources = options.resources;
    this.pollIntervalMs = options.pollIntervalMs;
    this.logger = options.logger.child({ module: 'AgentSandboxBackend' });
  }

  private resourceName(params: { name: string }): string {
    return `${this.namespace}/${params.name}`;
  }

  private body(params: { name: string; tenantId: string }): Record<string, unknown> {
    // Same writable-storage shape as PodBackend: an emptyDir mounted over the image WORKDIR, so a
    // container restart doesn't lose session files. The CR controller owns pod (re)scheduling,
    // not this backend, so this is the same durability guarantee as the Pod fallback — no more,
    // no less — until the CR spec grows a native persistent-storage field this can request instead.
    const container = {
      name: SANDBOX_CONTAINER_NAME,
      image: this.image,
      workingDir: SANDBOX_WORKING_DIR,
      volumeMounts: [{ name: WORKSPACE_VOLUME_NAME, mountPath: SANDBOX_WORKING_DIR }],
      ...(this.resources === undefined ? {} : { resources: this.resources }),
    };
    return {
      apiVersion: `${AGENT_SANDBOX_GROUP}/${AGENT_SANDBOX_VERSION}`,
      kind: 'Sandbox',
      metadata: {
        name: params.name,
        namespace: this.namespace,
        labels: { ...SANDBOX_LABELS },
        annotations: { [SANDBOX_TENANT_ANNOTATION]: params.tenantId },
      },
      spec: {
        operatingMode: 'Running',
        podTemplate: {
          metadata: { labels: { ...SANDBOX_LABELS } },
          spec: {
            ...(this.serviceAccountName === undefined ? {} : { serviceAccountName: this.serviceAccountName }),
            ...(this.imagePullSecretName === undefined
              ? {}
              : { imagePullSecrets: [{ name: this.imagePullSecretName }] }),
            restartPolicy: 'Always',
            volumes: [{ name: WORKSPACE_VOLUME_NAME, emptyDir: {} }],
            containers: [container],
          },
        },
      },
    };
  }

  async create(params: { name: string; tenantId: string }): Promise<void> {
    try {
      await this.api.createNamespacedCustomObject({
        group: AGENT_SANDBOX_GROUP,
        version: AGENT_SANDBOX_VERSION,
        namespace: this.namespace,
        plural: AGENT_SANDBOX_PLURAL,
        body: this.body(params),
      });
    } catch (error) {
      throw new Error(`Failed to create Agent Sandbox ${this.resourceName(params)}`, { cause: error });
    }
    this.logger.debug('Created Agent Sandbox resource', { namespace: this.namespace, name: params.name });
  }

  private async read(name: string): Promise<Record<string, unknown>> {
    try {
      return await this.api.getNamespacedCustomObject({
        group: AGENT_SANDBOX_GROUP,
        version: AGENT_SANDBOX_VERSION,
        namespace: this.namespace,
        plural: AGENT_SANDBOX_PLURAL,
        name,
      });
    } catch (error) {
      if (isNotFound(error)) {
        throw new SandboxNotAvailableError(this.resourceName({ name }));
      }
      throw new Error(`Failed to read Agent Sandbox ${this.resourceName({ name })}`, { cause: error });
    }
  }

  private async runningPod(name: string): Promise<SandboxPod | undefined> {
    let pod: V1Pod;
    try {
      pod = await this.podApi.readNamespacedPod({ name, namespace: this.namespace });
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw new Error(`Failed to read Agent Sandbox pod ${this.resourceName({ name })}`, { cause: error });
    }
    if (!podReady(pod) || pod.status?.podIP === undefined) {
      return undefined;
    }
    return {
      target: { namespace: this.namespace, podName: name, containerName: SANDBOX_CONTAINER_NAME },
      podIp: pod.status.podIP,
    };
  }

  async waitUntilRunning(params: { name: string; timeoutMs: number }): Promise<SandboxPod> {
    const deadline = Date.now() + params.timeoutMs;
    for (;;) {
      const resource = await this.read(params.name);
      const pod = await this.runningPod(params.name);
      if (readyCondition(resource) && pod !== undefined) {
        return pod;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Agent Sandbox ${this.resourceName(params)} did not become ready within ${String(params.timeoutMs)}ms`,
        );
      }
      await delay(this.pollIntervalMs);
    }
  }

  async getRunningPod(params: { name: string }): Promise<SandboxPod> {
    const resource = await this.read(params.name);
    const pod = await this.runningPod(params.name);
    if (!readyCondition(resource) || pod === undefined) {
      throw new SandboxNotAvailableError(this.resourceName(params));
    }
    return pod;
  }

  async delete(params: { name: string }): Promise<void> {
    try {
      await this.api.deleteNamespacedCustomObject({
        group: AGENT_SANDBOX_GROUP,
        version: AGENT_SANDBOX_VERSION,
        namespace: this.namespace,
        plural: AGENT_SANDBOX_PLURAL,
        name: params.name,
      });
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw new Error(`Failed to delete Agent Sandbox ${this.resourceName(params)}`, { cause: error });
    }
  }

  async list(): Promise<readonly SandboxListEntry[]> {
    const response = await this.api.listNamespacedCustomObject({
      group: AGENT_SANDBOX_GROUP,
      version: AGENT_SANDBOX_VERSION,
      namespace: this.namespace,
      plural: AGENT_SANDBOX_PLURAL,
      labelSelector: SANDBOX_LABEL_SELECTOR,
    });
    return (response.items ?? [])
      .flatMap(resource => {
        const metadata = resource['metadata'];
        const name = isRecord(metadata) && typeof metadata['name'] === 'string' ? metadata['name'] : undefined;
        const annotations = isRecord(metadata) ? metadata['annotations'] : undefined;
        const tenantId =
          isRecord(annotations) && typeof annotations[SANDBOX_TENANT_ANNOTATION] === 'string'
            ? annotations[SANDBOX_TENANT_ANNOTATION]
            : undefined;
        const createdAt = creationDate(resource);
        return name === undefined || createdAt === undefined ? [] : [{ name, createdAt, tenantId }];
      })
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }
}

export { AGENT_SANDBOX_GROUP, AGENT_SANDBOX_PLURAL, AGENT_SANDBOX_VERSION };
