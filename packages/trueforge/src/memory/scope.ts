import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import { createHash } from 'node:crypto';

/** Agent key for sessions without an agent that has memory: TrueForge acts as the default agent. */
export const DEFAULT_MEMORY_AGENT_KEY = 'trueforge';

/** UI "new chat" sessions carry `metadata['tfg.source'] = 'ui'`. */
export const UI_SESSION_SOURCE = 'ui';

/** Agent-builder chats carry `metadata['is_create_agent'] = 'true'`. */
export const CREATE_AGENT_SESSION_METADATA_KEY = 'is_create_agent';

export type MemoryScopeType = 'default' | 'agent';

/** Identifies whose memory: ids only, never a person's or agent's name. */
export interface MemoryScope {
  type: MemoryScopeType;
  tenantId: string;
  subjectId: string;
  /** Registry agent id for agent scopes; null for the default scope. */
  agentId: string | null;
  /** Provider-side identity of the scope (e.g. the provider's user id); see {@link memoryScopeKey}. */
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
  /** Agent-builder chat (`metadata['is_create_agent'] = 'true'`). */
  createAgentSession: boolean;
}

/**
 * Provider identity of a scope: `tfg-` plus sha256 of the JSON-encoded parts. Encoding keeps parts
 * apart (`a-b`+`c` ≠ `a`+`b-c`) and hashing keeps distinct subjects distinct (`john+x@` ≠ `john-x@`),
 * so two users can never share memory; it also keeps emails out of the provider id.
 */
export function memoryScopeKey({
  tenantId,
  agentKey,
  subjectId,
}: {
  tenantId: string;
  agentKey: string;
  subjectId: string;
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([tenantId, agentKey, subjectId]))
    .digest('hex');
  return `tfg-${digest}`;
}

/**
 * Which memory a session reads and writes; undefined when it has none. Agent-builder chats have
 * none. A registry agent's manifest decides for sessions bound to it: its own scope when memory is
 * on, none when off. Other UI sessions use the default TrueForge scope. Shared by ingestion and,
 * later, retrieval.
 */
export function resolveMemoryScope(session: MemoryScopeSession): MemoryScope | undefined {
  if (session.createAgentSession) {
    return undefined;
  }
  const tenantId = session.tenantId;
  const subjectId = session.createdBySubject.subject_id;
  if (session.agentId !== null) {
    if (!session.agentMemoryEnabled) {
      return undefined;
    }
    return {
      type: 'agent',
      tenantId,
      subjectId,
      agentId: session.agentId,
      key: memoryScopeKey({ tenantId, agentKey: session.agentId, subjectId }),
    };
  }
  if (session.tfgSource !== UI_SESSION_SOURCE) {
    return undefined;
  }
  return {
    type: 'default',
    tenantId,
    subjectId,
    agentId: null,
    key: memoryScopeKey({ tenantId, agentKey: DEFAULT_MEMORY_AGENT_KEY, subjectId }),
  };
}
