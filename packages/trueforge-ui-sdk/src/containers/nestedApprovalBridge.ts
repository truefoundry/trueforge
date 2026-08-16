'use client';

import { createContext, useContext } from 'react';

/**
 * Sub-agent tool calls render inside a read-only nested thread
 * (`MessagePartPrimitive.Messages`), so `part.respondToApproval` throws.
 * When this flag is set, `ToolApprovalSlot` routes Allow/Deny through
 * `useTrueFoundryRespondToToolApproval()` using the *nested* tool's
 * approval id (not the outer `create_sub_agent` part).
 */
export const NestedApprovalBridgeContext = createContext(false);

export function useNestedApprovalBridge(): boolean {
  return useContext(NestedApprovalBridgeContext);
}
