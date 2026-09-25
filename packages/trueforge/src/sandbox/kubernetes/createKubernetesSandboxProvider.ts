import {
  ApiextensionsV1Api,
  CoreV1Api,
  CustomObjectsApi,
  Exec,
  KubeConfig,
  type V1ResourceRequirements,
} from '@kubernetes/client-node';
import { SANDBOX_IMAGE_URI, type SandboxProvider } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { KubernetesSandboxProvider as KubernetesManifest } from '../../schemas/sandboxProvider';
import { AgentSandboxBackend, type AgentSandboxApi } from './backend/AgentSandboxBackend';
import { PodBackend, type PodApi } from './backend/PodBackend';
import { type SandboxBackend } from './backend/SandboxBackend';
import { toPodExecClient } from './core/kubeExec';
import { KubernetesNatsHostUrlResolver } from './core/natsHostUrl';
import { KubernetesSandboxProvider as KubernetesProvider } from './provider/KubernetesSandboxProvider';

interface KubernetesApiClients {
  core: CoreV1Api;
  custom: CustomObjectsApi;
  apiextensions: ApiextensionsV1Api;
}

function resources(value: KubernetesManifest['resources']): V1ResourceRequirements | undefined {
  if (value === undefined) {
    return undefined;
  }
  return {
    ...(value.requests === undefined ? {} : { requests: value.requests }),
    ...(value.limits === undefined ? {} : { limits: value.limits }),
  };
}

function clients(kubeConfig: KubeConfig): KubernetesApiClients {
  return {
    core: kubeConfig.makeApiClient(CoreV1Api),
    custom: kubeConfig.makeApiClient(CustomObjectsApi),
    apiextensions: kubeConfig.makeApiClient(ApiextensionsV1Api),
  };
}

function podApi(api: CoreV1Api): PodApi {
  return {
    createNamespacedPod: params => api.createNamespacedPod(params),
    readNamespacedPod: params => api.readNamespacedPod(params),
    deleteNamespacedPod: params => api.deleteNamespacedPod(params),
    listNamespacedPod: params => api.listNamespacedPod(params),
  };
}

function agentApi(api: CustomObjectsApi): AgentSandboxApi {
  return {
    createNamespacedCustomObject: params => api.createNamespacedCustomObject(params),
    getNamespacedCustomObject: params => api.getNamespacedCustomObject(params),
    deleteNamespacedCustomObject: params => api.deleteNamespacedCustomObject(params),
    listNamespacedCustomObject: params => api.listNamespacedCustomObject(params),
  };
}

async function hasAgentSandboxCrd(api: ApiextensionsV1Api): Promise<boolean> {
  try {
    await api.readCustomResourceDefinition({ name: 'sandboxes.agents.x-k8s.io' });
    return true;
  } catch {
    return false;
  }
}

/** Builds the Kubernetes provider and chooses the Agent Sandbox CR backend once at construction. */
export async function createKubernetesSandboxProvider(options: {
  manifest: KubernetesManifest;
  tenantId: string;
  fileMaxBytesForDownload: number;
  createTimeoutMs: number;
  reaperTtlMs: number;
  pollIntervalMs: number;
  inCluster: boolean;
  logger: Logger;
}): Promise<SandboxProvider> {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  const apis = clients(kubeConfig);
  const pods = podApi(apis.core);
  const useAgentSandbox = await hasAgentSandboxCrd(apis.apiextensions);
  const backend: SandboxBackend = useAgentSandbox
    ? new AgentSandboxBackend({
        api: agentApi(apis.custom),
        podApi: pods,
        namespace: options.manifest.namespace,
        image: SANDBOX_IMAGE_URI,
        serviceAccountName: options.manifest.service_account_name,
        imagePullSecretName: options.manifest.image_pull_secret_name,
        resources: resources(options.manifest.resources),
        pollIntervalMs: options.pollIntervalMs,
        logger: options.logger,
      })
    : new PodBackend({
        api: pods,
        namespace: options.manifest.namespace,
        image: SANDBOX_IMAGE_URI,
        serviceAccountName: options.manifest.service_account_name,
        imagePullSecretName: options.manifest.image_pull_secret_name,
        resources: resources(options.manifest.resources),
        pollIntervalMs: options.pollIntervalMs,
        logger: options.logger,
      });
  const natsResolver = new KubernetesNatsHostUrlResolver({
    kubeConfig,
    inCluster: options.inCluster,
    logger: options.logger,
  });
  return new KubernetesProvider({
    backend,
    execClient: toPodExecClient(new Exec(kubeConfig)),
    resolveNatsHostUrl: natsResolver.resolve,
    tenantName: options.tenantId,
    fileMaxBytesForDownload: options.fileMaxBytesForDownload,
    defaultExecTimeoutMs: options.manifest.exec_timeout_ms,
    createTimeoutMs: options.createTimeoutMs,
    reaperTtlMs: options.reaperTtlMs,
    logger: options.logger,
  });
}
