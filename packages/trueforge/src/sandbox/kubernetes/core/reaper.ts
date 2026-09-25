import type { Logger } from 'winston';
import type { SandboxBackend } from '../backend/SandboxBackend';

/** Deletes stale resources through the backend's label-scoped list/delete operations. */
export class KubernetesSandboxReaper {
  private readonly backend: SandboxBackend;
  private readonly tenantId: string;
  private readonly ttlMs: number;
  private readonly logger: Logger;

  constructor(options: { backend: SandboxBackend; tenantId: string; ttlMs: number; logger: Logger }) {
    this.backend = options.backend;
    this.tenantId = options.tenantId;
    this.ttlMs = options.ttlMs;
    this.logger = options.logger.child({ module: 'KubernetesSandboxReaper' });
  }

  async reap(now = Date.now()): Promise<number> {
    if (this.ttlMs <= 0) {
      return 0;
    }
    const cutoff = now - this.ttlMs;
    const entries = await this.backend.list();
    let deleted = 0;
    for (const entry of entries) {
      if (entry.tenantId !== this.tenantId || entry.createdAt.getTime() >= cutoff) {
        continue;
      }
      try {
        await this.backend.delete({ name: entry.name });
        deleted += 1;
      } catch (error) {
        this.logger.warn('Failed to reap stale Kubernetes sandbox', { error, name: entry.name });
      }
    }
    return deleted;
  }
}
