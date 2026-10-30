import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';

/** Agent key for sessions without an agent that has memory: TrueForge acts as the default agent. */
export const DEFAULT_MEMORY_AGENT_KEY = 'trueforge';

/** UI "new chat" sessions carry `metadata['tfg.source'] = 'ui'`. */
export const UI_SESSION_SOURCE = 'ui';

export type MemoryScopeType = 'default' | 'agent';

export interface MemoryScope {
  type: MemoryScopeType;
  tenantId: string;
  subjectId: string;
  displayName: string;
  /** Registry agent id for agent scopes; null for the default scope. */
  agentId: string | null;
  /** Provider-side identity of the scope (e.g. the Zep user id). */
  key: string;
}

export interface MemoryScopeSession {
  tenantId: string;
  createdBySubject: CreatedBySubject;
  /** Registry agent binding; null for inline-spec sessions. */
  agentId: string | null;
  /** Whether the bound registry agent has memory enabled. */
  agentMemoryEnabled: boolean;
  /** `metadata['tfg.source']`, when present. */
  tfgSource: string | null;
}

export type MemoryScopeResolution =
  { eligible: true; scope: MemoryScope } | { eligible: false; reason: 'agent_disabled' | 'not_memory_session' };

const UNSAFE_KEY_CHARS = /[^A-Za-z0-9._-]+/g;

function keyPart(value: string): string {
  return value.replace(UNSAFE_KEY_CHARS, '-');
}

export function memoryScopeKey({
  tenantId,
  agentKey,
  subjectId,
}: {
  tenantId: string;
  agentKey: string;
  subjectId: string;
}): string {
  return ['tfg', tenantId, agentKey, subjectId].map(keyPart).join('-');
}

/**
 * Which memory a session reads and writes. A registry agent's manifest decides for sessions bound
 * to it: its own scope when memory is on, none when off. Other UI sessions use the default
 * TrueForge scope. Shared by ingestion and, later, retrieval.
 */
export function resolveMemoryScope(session: MemoryScopeSession): MemoryScopeResolution {
  const base = {
    tenantId: session.tenantId,
    subjectId: session.createdBySubject.subject_id,
    displayName: session.createdBySubject.subject_display_name,
  };
  if (session.agentId !== null) {
    if (!session.agentMemoryEnabled) {
      return { eligible: false, reason: 'agent_disabled' };
    }
    return {
      eligible: true,
      scope: {
        ...base,
        type: 'agent',
        agentId: session.agentId,
        key: memoryScopeKey({ tenantId: base.tenantId, agentKey: session.agentId, subjectId: base.subjectId }),
      },
    };
  }
  if (session.tfgSource !== UI_SESSION_SOURCE) {
    return { eligible: false, reason: 'not_memory_session' };
  }
  return {
    eligible: true,
    scope: {
      ...base,
      type: 'default',
      agentId: null,
      key: memoryScopeKey({ tenantId: base.tenantId, agentKey: DEFAULT_MEMORY_AGENT_KEY, subjectId: base.subjectId }),
    },
  };
}
