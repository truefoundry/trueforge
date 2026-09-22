import type { RemoteThreadMetadata } from '@assistant-ui/core';

import { draftSessionTitle } from './draft/agentSpec.js';
import type { AgentSpec, Session } from './server/types.js';

/**
 * Title for a session row in a mixed (draft + named) thread list.
 * Mutable sessions use draftSessionTitle (optionally falling back to
 * `defaultAgentSpec`); named sessions use title → agentName → id.
 */
export function sessionDisplayTitle(session: Session, defaultAgentSpec?: AgentSpec): string {
  if (session.isMutable) {
    const agentSpec = session.agentSpec ?? defaultAgentSpec;
    if (agentSpec != null) {
      return draftSessionTitle({
        agentSpec,
        ...(session.title === undefined ? {} : { title: session.title }),
      });
    }
  }
  return session.title ?? session.agentName ?? session.id;
}

/** Map a Session DTO onto RemoteThreadMetadata (mutability + display name in custom). */
export function sessionToThreadMetadata(session: Session, title: string | undefined): RemoteThreadMetadata {
  return {
    status: 'regular',
    remoteId: session.id,
    title,
    lastMessageAt: new Date(session.updatedAt),
    custom: {
      isMutable: session.isMutable,
      ...(session.agentName != null ? { agentName: session.agentName } : {}),
    },
  };
}
