import { ApiException, type V1Pod, type V1PodList } from '@kubernetes/client-node';
import { SandboxNotAvailableError } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { PodBackend, type PodApi } from '../../../../../src/sandbox/kubernetes/backend/PodBackend';
import {
  SANDBOX_LABEL_SELECTOR,
  SANDBOX_TENANT_ANNOTATION,
} from '../../../../../src/sandbox/kubernetes/backend/SandboxBackend';

const NAMESPACE = 'trueforge-sandboxes';
const IMAGE = 'registry.example/trueforge-sandbox:abc123';

function runningPod(name: string, podIp = '10.1.2.3'): V1Pod {
  return {
    metadata: { name, namespace: NAMESPACE, creationTimestamp: new Date('2026-01-01T00:00:00Z') },
    status: {
      phase: 'Running',
      podIP: podIp,
      conditions: [{ type: 'Ready', status: 'True' }],
    },
  };
}

function pendingPod(name: string): V1Pod {
  return {
    metadata: { name, namespace: NAMESPACE },
    status: { phase: 'Pending', conditions: [{ type: 'Ready', status: 'False' }] },
  };
}

function imagePullBackOffPod(name: string): V1Pod {
  return {
    metadata: { name, namespace: NAMESPACE },
    status: {
      phase: 'Pending',
      containerStatuses: [
        {
          name: 'sandbox',
          image: IMAGE,
          imageID: '',
          ready: false,
          restartCount: 0,
          state: { waiting: { reason: 'ImagePullBackOff', message: `Back-off pulling image "${IMAGE}"` } },
        },
      ],
    },
  };
}

interface FakeApiScript {
  reads?: (V1Pod | ApiException<unknown>)[];
  list?: V1PodList;
  createError?: unknown;
  deleteError?: unknown;
}

function fakeApi(script: FakeApiScript = {}): {
  api: PodApi;
  created: V1Pod[];
  deleted: string[];
  listArgs: unknown[];
} {
  const created: V1Pod[] = [];
  const deleted: string[] = [];
  const listArgs: unknown[] = [];
  let readIndex = 0;
  const api: PodApi = {
    createNamespacedPod: params => {
      if (script.createError !== undefined) {
        return Promise.reject(script.createError);
      }
      created.push(params.body);
      return Promise.resolve(params.body);
    },
    readNamespacedPod: () => {
      const reads = script.reads ?? [];
      const next = reads[Math.min(readIndex, reads.length - 1)];
      readIndex += 1;
      if (next === undefined) {
        return Promise.reject(new ApiException(404, 'not found', {}, {}));
      }
      return next instanceof ApiException ? Promise.reject(next) : Promise.resolve(next);
    },
    deleteNamespacedPod: params => {
      if (script.deleteError !== undefined) {
        return Promise.reject(script.deleteError);
      }
      deleted.push(params.name);
      return Promise.resolve({});
    },
    listNamespacedPod: params => {
      listArgs.push(params);
      return Promise.resolve(script.list ?? { items: [] });
    },
  };
  return { api, created, deleted, listArgs };
}

function backend(api: PodApi): PodBackend {
  return new PodBackend({
    api,
    namespace: NAMESPACE,
    image: IMAGE,
    serviceAccountName: 'trueforge-sandbox',
    imagePullSecretName: 'regcred',
    resources: { requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '2', memory: '4Gi' } },
    pollIntervalMs: 1,
    logger: createLogger({ silent: true }),
  });
}

describe('PodBackend', () => {
  it('creates a labelled pod from the configured image and pod settings', async () => {
    const { api, created } = fakeApi();

    await backend(api).create({ name: 'sbx-1', tenantId: 'acme' });

    const pod = created[0];
    expect(pod?.metadata?.name).toBe('sbx-1');
    expect(pod?.metadata?.namespace).toBe(NAMESPACE);
    expect(pod?.metadata?.labels).toMatchObject({
      'app.kubernetes.io/name': 'trueforge-sandbox',
      'app.kubernetes.io/managed-by': 'trueforge',
    });
    expect(pod?.metadata?.annotations?.[SANDBOX_TENANT_ANNOTATION]).toBe('acme');
    expect(pod?.spec?.serviceAccountName).toBe('trueforge-sandbox');
    expect(pod?.spec?.imagePullSecrets).toEqual([{ name: 'regcred' }]);
    const container = pod?.spec?.containers[0];
    expect(container?.image).toBe(IMAGE);
    expect(container?.resources?.limits).toEqual({ cpu: '2', memory: '4Gi' });
  });

  it('mounts writable storage over the image working directory so a container restart keeps state', async () => {
    const { api, created } = fakeApi();

    await backend(api).create({ name: 'sbx-1', tenantId: 'acme' });

    const container = created[0]?.spec?.containers[0];
    const mount = container?.volumeMounts?.find(entry => entry.mountPath === container.workingDir);
    expect(mount).toBeDefined();
    expect(created[0]?.spec?.volumes?.some(volume => volume.name === mount?.name)).toBe(true);
  });

  it('omits the service account and pull secret when they are not configured', async () => {
    const { api, created } = fakeApi();
    const bare = new PodBackend({
      api,
      namespace: NAMESPACE,
      image: IMAGE,
      serviceAccountName: undefined,
      imagePullSecretName: undefined,
      resources: undefined,
      pollIntervalMs: 1,
      logger: createLogger({ silent: true }),
    });

    await bare.create({ name: 'sbx-1', tenantId: 'acme' });

    expect('serviceAccountName' in (created[0]?.spec ?? {})).toBe(false);
    expect('imagePullSecrets' in (created[0]?.spec ?? {})).toBe(false);
    expect('resources' in (created[0]?.spec?.containers[0] ?? {})).toBe(false);
  });

  it('polls until the pod is running and ready, then reports its address', async () => {
    const { api } = fakeApi({ reads: [pendingPod('sbx-1'), pendingPod('sbx-1'), runningPod('sbx-1', '10.4.5.6')] });

    const pod = await backend(api).waitUntilRunning({ name: 'sbx-1', timeoutMs: 5_000 });

    expect(pod.podIp).toBe('10.4.5.6');
    expect(pod.target).toEqual({ namespace: NAMESPACE, podName: 'sbx-1', containerName: 'sandbox' });
  });

  it('fails loudly on an unpullable image instead of waiting for the timeout', async () => {
    const { api } = fakeApi({ reads: [imagePullBackOffPod('sbx-1')] });

    await expect(backend(api).waitUntilRunning({ name: 'sbx-1', timeoutMs: 5_000 })).rejects.toThrow(
      /ImagePullBackOff/,
    );
  });

  it('fails when the pod reaches a terminal phase', async () => {
    const failed: V1Pod = {
      metadata: { name: 'sbx-1', namespace: NAMESPACE },
      status: { phase: 'Failed', reason: 'Evicted', message: 'The node was low on resource: memory' },
    };
    const { api } = fakeApi({ reads: [failed] });

    await expect(backend(api).waitUntilRunning({ name: 'sbx-1', timeoutMs: 5_000 })).rejects.toThrow(/Evicted/);
  });

  it('times out when the pod never becomes ready', async () => {
    const { api } = fakeApi({ reads: [pendingPod('sbx-1')] });

    await expect(backend(api).waitUntilRunning({ name: 'sbx-1', timeoutMs: 30 })).rejects.toThrow(
      /did not become ready/i,
    );
  });

  it('reports a deleted sandbox as unavailable rather than a raw API error', async () => {
    const { api } = fakeApi({ reads: [new ApiException(404, 'pods "sbx-1" not found', {}, {})] });

    await expect(backend(api).getRunningPod({ name: 'sbx-1' })).rejects.toBeInstanceOf(SandboxNotAvailableError);
  });

  it('reports an evicted pod as unavailable on a later exec', async () => {
    const evicted: V1Pod = {
      metadata: { name: 'sbx-1', namespace: NAMESPACE },
      status: { phase: 'Failed', reason: 'Evicted' },
    };
    const { api } = fakeApi({ reads: [evicted] });

    await expect(backend(api).getRunningPod({ name: 'sbx-1' })).rejects.toBeInstanceOf(SandboxNotAvailableError);
  });

  it('treats an already-deleted sandbox as deleted', async () => {
    const { api } = fakeApi({ deleteError: new ApiException(404, 'not found', {}, {}) });

    await expect(backend(api).delete({ name: 'sbx-1' })).resolves.toBeUndefined();
  });

  it('propagates a delete failure that is not a 404, preserving the cause', async () => {
    const cause = new ApiException(500, 'boom', {}, {});
    const { api } = fakeApi({ deleteError: cause });

    await expect(backend(api).delete({ name: 'sbx-1' })).rejects.toMatchObject({ cause });
  });

  it('lists managed sandboxes oldest first using the shared label selector', async () => {
    const { api, listArgs } = fakeApi({
      list: {
        items: [
          { metadata: { name: 'newer', creationTimestamp: new Date('2026-02-01T00:00:00Z') } },
          { metadata: { name: 'older', creationTimestamp: new Date('2026-01-01T00:00:00Z') } },
          { metadata: { creationTimestamp: new Date('2026-01-01T00:00:00Z') } },
        ],
      },
    });

    const entries = await backend(api).list();

    expect(entries.map(entry => entry.name)).toEqual(['older', 'newer']);
    expect(listArgs[0]).toMatchObject({ namespace: NAMESPACE, labelSelector: SANDBOX_LABEL_SELECTOR });
  });

  it('wraps a create failure with its cause', async () => {
    const cause = new ApiException(403, 'forbidden', {}, {});
    const { api } = fakeApi({ createError: cause });

    await expect(backend(api).create({ name: 'sbx-1', tenantId: 'acme' })).rejects.toMatchObject({ cause });
  });
});
