/** What the provider needs from whichever Kubernetes resource backs a sandbox. */
import type { PodExecTarget } from '../core/kubeExec';

/** Labels every sandbox resource carries, so an operator (and the reaper) can find them. */
export const SANDBOX_LABELS = {
  'app.kubernetes.io/name': 'trueforge-sandbox',
  'app.kubernetes.io/managed-by': 'trueforge',
} as const;

/** Selector matching the shared sandbox labels. */
export const SANDBOX_LABEL_SELECTOR = Object.entries(SANDBOX_LABELS)
  .map(([key, value]) => `${key}=${value}`)
  .join(',');

/** Tenant is an annotation, not a label: tenant ids are not constrained to the label charset. */
export const SANDBOX_TENANT_ANNOTATION = 'trueforge.dev/tenant';

/** A sandbox's pod once it is running. */
export interface SandboxPod {
  target: PodExecTarget;
  /** Cluster-routable address of the pod, used to reach its NATS bridge. */
  podIp: string;
}

/** One sandbox as the reaper sees it. */
export interface SandboxListEntry {
  name: string;
  createdAt: Date;
  tenantId?: string | undefined;
}

export interface SandboxBackend {
  /** Backing resource kind, recorded in the build metadata so operators can see which path ran. */
  readonly kind: 'pod' | 'agent-sandbox';
  /** Creates the sandbox resource. Returns once the API server has accepted it, not once it runs. */
  create(params: { name: string; tenantId: string }): Promise<void>;
  /** Resolves once the sandbox is running and reachable. */
  waitUntilRunning(params: { name: string; timeoutMs: number }): Promise<SandboxPod>;
  /** The running pod for an existing sandbox. */
  getRunningPod(params: { name: string }): Promise<SandboxPod>;
  /** Deletes the sandbox. Succeeds when it is already gone. */
  delete(params: { name: string }): Promise<void>;
  /** Every sandbox this backend manages in its namespace, oldest first. */
  list(): Promise<readonly SandboxListEntry[]>;
}
