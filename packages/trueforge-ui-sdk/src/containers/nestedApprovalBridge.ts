'use client';

import type { ToolApprovalResponse } from '@assistant-ui/react';
import { createContext, useContext } from 'react';

/**
 * Sub-agent tool calls render inside a read-only nested thread context
 * (`MessagePartPrimitive.Messages`), so the standard `respondToApproval` prop
 * on their parts doesn't route back to the gateway. `ToolCallContainer` uses
 * this bridge instead when rendering nested calls, translating the response
 * through `useTrueFoundryRespondToToolApproval()` -- mirrors the reference's
 * `nestedToolCallMessageComponents` override.
 */
export const NestedApprovalBridgeContext = createContext<((response: ToolApprovalResponse) => void) | null>(null);

export function useNestedApprovalBridge(): ((response: ToolApprovalResponse) => void) | null {
  return useContext(NestedApprovalBridgeContext);
}
