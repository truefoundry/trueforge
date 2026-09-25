import { ApiException, type V1Pod } from '@kubernetes/client-node';
import { SandboxNotAvailableError } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import {
  AGENT_SANDBOX_GROUP,
  AGENT_SANDBOX_PLURAL,
  AGENT_SANDBOX_VERSION,
  AgentSandboxBackend,
  type AgentSandboxApi,
  type AgentSandboxPodApi,
} from '../../../../../src/sandbox/kubernetes/backend/AgentSandboxBackend';
import { SANDBOX_TENANT_ANNOTATION } from '../../../../../src/sandbox/kubernetes/backend/SandboxBackend';

const NAMESPACE = 'trueforge-sandboxes';
const IMAGE = 'registry.example/trueforge-sandbox:abc123';

function readyResource(name: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    metadata: { name, namespace: NAMESPACE, creationTimestamp: '2026-01-01T00:00:00Z' },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
    ...overrides,
  };
}

function notReadyResource(name: string): Record<string, unknown> {
  return {
    metadata: { name, namespace: NAMESPACE, creationTimestamp: '2026-01-01T00:00:00Z' },
    status: { conditions: [{ type: 'Ready', status: 'False' }] },
  };
}

function runningPod(podIp = '10.1.2.3'): V1Pod {
  return {
    status: { phase: 'Running', podIP: podIp, conditions: [{ type: 'Ready', status: 'True' }] },
  };
}

function pendingPod(): V1Pod {
  return { status: { phase: 'Pending', conditions: [{ type: 'Ready', status: 'False' }] } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, description: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`expected ${description} to be an object`);
  }
  return value;
}

/** Navigates the untyped CR body down to spec.podTemplate.spec, with runtime guards — no `as`. */
function podSpecOf(body: Record<string, unknown>): Record<string, unknown> {
  const spec = expectRecord(body['spec'], 'body.spec');
  const podTemplate = expectRecord(spec['podTemplate'], 'body.spec.podTemplate');
  return expectRecord(podTemplate['spec'], 'body.spec.podTemplate.spec');
}

function firstContainerOf(podSpec: Record<string, unknown>): Record<string, unknown> {
  const containers = podSpec['containers'];
  if (!Array.isArray(containers)) {
    throw new Error('expected podSpec.containers to be an array');
  }
  return expectRecord(containers[0], 'podSpec.containers[0]');
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

interface FakeApiScript {
  create?: unknown;
  reads?: (Record<string, unknown> | ApiException<unknown>)[];
  pods?: (V1Pod | ApiException<unknown>)[];
  list?: { items?: Record<string, unknown>[] };
  deleteError?: unknown;
}

function fakeApi(script: FakeApiScript = {}): {
  api: AgentSandboxApi;
  podApi: AgentSandboxPodApi;
  created: Record<string, unknown>[];
  deleted: string[];
} {
  const created: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  let readIndex = 0;
  let podIndex = 0;
  const api: AgentSandboxApi = {
    createNamespacedCustomObject: params => {
      if (script.create !== undefined) {
        return Promise.reject(script.create);
      }
      created.push(params.body);
      return Promise.resolve(params.body);
    },
    getNamespacedCustomObject: () => {
      const reads = script.reads ?? [];
      const next = reads[Math.min(readIndex, reads.length - 1)];
      readIndex += 1;
      if (next === undefined) {
        return Promise.reject(new ApiException(404, 'not found', {}, {}));
      }
      return next instanceof ApiException ? Promise.reject(next) : Promise.resolve(next);
    },
    deleteNamespacedCustomObject: params => {
      if (script.deleteError !== undefined) {
        return Promise.reject(script.deleteError);
      }
      deleted.push(params.name);
      return Promise.resolve({});
    },
    listNamespacedCustomObject: () => Promise.resolve(script.list ?? { items: [] }),
  };
  const podApi: AgentSandboxPodApi = {
    readNamespacedPod: () => {
      const pods = script.pods ?? [];
      const next = pods[Math.min(podIndex, pods.length - 1)];
      podIndex += 1;
      if (next === undefined) {
        return Promise.reject(new ApiException(404, 'pod not found', {}, {}));
      }
      return next instanceof ApiException ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return { api, podApi, created, deleted };
}

function backend(params: { api: AgentSandboxApi; podApi: AgentSandboxPodApi }): AgentSandboxBackend {
  return new AgentSandboxBackend({
    api: params.api,
    podApi: params.podApi,
    namespace: NAMESPACE,
    image: IMAGE,
    serviceAccountName: 'trueforge-sandbox',
    imagePullSecretName: 'regcred',
    resources: { requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '2', memory: '4Gi' } },
    pollIntervalMs: 1,
    logger: createLogger({ silent: true }),
  });
}

describe('AgentSandboxBackend', () => {
  it('reports its backend kind', () => {
    const { api, podApi } = fakeApi();
    expect(backend({ api, podApi }).kind).toBe('agent-sandbox');
  });

  it('creates a labelled Sandbox CR with the pod template settings', async () => {
    const { api, podApi, created } = fakeApi();

    await backend({ api, podApi }).create({ name: 'sbx-1', tenantId: 'acme' });

    const body = expectRecord(created[0], 'created[0]');
    expect(body['apiVersion']).toBe(`${AGENT_SANDBOX_GROUP}/${AGENT_SANDBOX_VERSION}`);
    expect(body['kind']).toBe('Sandbox');
    expect(body['metadata']).toMatchObject({
      name: 'sbx-1',
      namespace: NAMESPACE,
      labels: { 'app.kubernetes.io/name': 'trueforge-sandbox', 'app.kubernetes.io/managed-by': 'trueforge' },
      annotations: { [SANDBOX_TENANT_ANNOTATION]: 'acme' },
    });
    const podSpec = podSpecOf(body);
    expect(podSpec['serviceAccountName']).toBe('trueforge-sandbox');
    expect(podSpec['imagePullSecrets']).toEqual([{ name: 'regcred' }]);
    const container = firstContainerOf(podSpec);
    expect(container['image']).toBe(IMAGE);
    expect(container['resources']).toMatchObject({ limits: { cpu: '2', memory: '4Gi' } });
  });

  it('mounts writable storage over the image working directory, same as PodBackend', async () => {
    const { api, podApi, created } = fakeApi();

    await backend({ api, podApi }).create({ name: 'sbx-1', tenantId: 'acme' });

    const podSpec = podSpecOf(expectRecord(created[0], 'created[0]'));
    const container = firstContainerOf(podSpec);
    const mount = recordArray(container['volumeMounts']).find(entry => entry['mountPath'] === container['workingDir']);
    expect(mount).toBeDefined();
    expect(recordArray(podSpec['volumes']).some(volume => volume['name'] === mount?.['name'])).toBe(true);
  });

  it('omits the service account, pull secret, and resources when not configured', async () => {
    const { api, podApi, created } = fakeApi();
    const bare = new AgentSandboxBackend({
      api,
      podApi,
      namespace: NAMESPACE,
      image: IMAGE,
      serviceAccountName: undefined,
      imagePullSecretName: undefined,
      resources: undefined,
      pollIntervalMs: 1,
      logger: createLogger({ silent: true }),
    });

    await bare.create({ name: 'sbx-1', tenantId: 'acme' });

    const podSpec = podSpecOf(expectRecord(created[0], 'created[0]'));
    expect('serviceAccountName' in podSpec).toBe(false);
    expect('imagePullSecrets' in podSpec).toBe(false);
    expect('resources' in firstContainerOf(podSpec)).toBe(false);
  });

  it('waits for both the CR Ready condition and a running pod before resolving', async () => {
    const { api, podApi } = fakeApi({
      reads: [notReadyResource('sbx-1'), readyResource('sbx-1')],
      pods: [pendingPod(), runningPod('10.4.5.6')],
    });

    const pod = await backend({ api, podApi }).waitUntilRunning({ name: 'sbx-1', timeoutMs: 5_000 });

    expect(pod.podIp).toBe('10.4.5.6');
    expect(pod.target).toEqual({ namespace: NAMESPACE, podName: 'sbx-1', containerName: 'sandbox' });
  });

  it('times out when the CR never reports Ready', async () => {
    const { api, podApi } = fakeApi({ reads: [notReadyResource('sbx-1')], pods: [runningPod()] });

    await expect(backend({ api, podApi }).waitUntilRunning({ name: 'sbx-1', timeoutMs: 30 })).rejects.toThrow(
      /did not become ready/i,
    );
  });

  it('reports a missing Sandbox CR as unavailable rather than a raw API error', async () => {
    const { api, podApi } = fakeApi({ reads: [new ApiException(404, 'not found', {}, {})] });

    await expect(backend({ api, podApi }).getRunningPod({ name: 'sbx-1' })).rejects.toBeInstanceOf(
      SandboxNotAvailableError,
    );
  });

  it('reports a Ready CR with no running pod yet as unavailable', async () => {
    const { api, podApi } = fakeApi({ reads: [readyResource('sbx-1')], pods: [pendingPod()] });

    await expect(backend({ api, podApi }).getRunningPod({ name: 'sbx-1' })).rejects.toBeInstanceOf(
      SandboxNotAvailableError,
    );
  });

  it('treats an already-deleted sandbox as deleted', async () => {
    const { api, podApi } = fakeApi({ deleteError: new ApiException(404, 'not found', {}, {}) });

    await expect(backend({ api, podApi }).delete({ name: 'sbx-1' })).resolves.toBeUndefined();
  });

  it('propagates a delete failure that is not a 404, preserving the cause', async () => {
    const cause = new ApiException(500, 'boom', {}, {});
    const { api, podApi } = fakeApi({ deleteError: cause });

    await expect(backend({ api, podApi }).delete({ name: 'sbx-1' })).rejects.toMatchObject({ cause });
  });

  it('wraps a create failure with its cause', async () => {
    const cause = new ApiException(403, 'forbidden', {}, {});
    const { api, podApi } = fakeApi({ create: cause });

    await expect(backend({ api, podApi }).create({ name: 'sbx-1', tenantId: 'acme' })).rejects.toMatchObject({
      cause,
    });
  });

  it("lists managed sandboxes oldest first, with each entry's tenant id", async () => {
    const { api, podApi } = fakeApi({
      list: {
        items: [
          readyResource('newer', {
            metadata: {
              name: 'newer',
              creationTimestamp: '2026-02-01T00:00:00Z',
              annotations: { [SANDBOX_TENANT_ANNOTATION]: 'acme' },
            },
          }),
          readyResource('older', {
            metadata: {
              name: 'older',
              creationTimestamp: '2026-01-01T00:00:00Z',
              annotations: { [SANDBOX_TENANT_ANNOTATION]: 'acme' },
            },
          }),
        ],
      },
    });

    const entries = await backend({ api, podApi }).list();

    expect(entries.map(entry => entry.name)).toEqual(['older', 'newer']);
    expect(entries.every(entry => entry.tenantId === 'acme')).toBe(true);
  });

  it('uses the agents.x-k8s.io/v1beta1 sandboxes custom resource', () => {
    expect(AGENT_SANDBOX_GROUP).toBe('agents.x-k8s.io');
    expect(AGENT_SANDBOX_VERSION).toBe('v1beta1');
    expect(AGENT_SANDBOX_PLURAL).toBe('sandboxes');
  });
});
