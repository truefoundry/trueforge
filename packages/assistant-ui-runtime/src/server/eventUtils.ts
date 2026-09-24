/**
 * Local implementations of streaming delta helpers.
 * Formerly imported from trueforge-gateway-sdk/agents.
 */

import type {
  DeltaEvents,
  ModelMessageDeltaEvent,
  ModelMessageEvent,
  ToolCall,
  ToolInfo,
  TurnEvent,
  TurnStreamingEvent,
} from './events.js';
import { EVENT_TYPE, TOOL_INFO_TYPE } from './events.js';

/** True for `.delta` streaming events. */
export function isEventDelta(event: TurnStreamingEvent): event is DeltaEvents {
  return typeof event.type === 'string' && event.type.endsWith('.delta');
}

/**
 * Merge `delta` into `base` in place (same `id` required).
 * Currently handles `model.message.delta` → `model.message`.
 */
export function mergeEventDelta(base: TurnEvent, delta: DeltaEvents): void {
  if (base.id !== delta.id) {
    throw new Error(`Cannot merge delta into a different event: base id "${base.id}" != delta id "${delta.id}".`);
  }
  if (base.type === EVENT_TYPE.MODEL_MESSAGE) {
    mergeModelMessageDelta(base, delta);
  }
}

function asToolInfo(value: unknown): ToolInfo | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }
  const type: unknown = Reflect.get(value, 'type');
  if (typeof type !== 'string') {
    return undefined;
  }
  const name: unknown = Reflect.get(value, 'name');
  if (type === TOOL_INFO_TYPE.TRUEFORGE_SYSTEM) {
    return typeof name === 'string' ? { type, name } : undefined;
  }
  if (type === TOOL_INFO_TYPE.MCP) {
    const serverId: unknown = Reflect.get(value, 'serverId');
    const serverName: unknown = Reflect.get(value, 'serverName');
    return typeof serverId === 'string' && typeof serverName === 'string' && typeof name === 'string'
      ? { type, serverId, serverName, name }
      : undefined;
  }
  return typeof name === 'string' ? { type, name } : { type };
}

function mergeModelMessageDelta(base: ModelMessageEvent, delta: ModelMessageDeltaEvent): void {
  if (delta.content) {
    if (base.content === undefined || base.content === null || typeof base.content === 'string') {
      base.content = (base.content ?? '') + delta.content;
    } else {
      const last = base.content[base.content.length - 1];
      if (last?.type === 'text') {
        last.text += delta.content;
      } else {
        base.content.push({ type: 'text', text: delta.content });
      }
    }
  }

  if (delta.refusal) {
    base.refusal = (base.refusal ?? '') + delta.refusal;
  }

  if (delta.toolCalls) {
    base.toolCalls ??= [];
    for (const d of delta.toolCalls) {
      let tc: ToolCall | undefined = base.toolCalls[d.index];
      if (tc === undefined) {
        const toolInfo = asToolInfo(d.toolInfo);
        tc = {
          id: d.id ?? '',
          type: d.type ?? 'function',
          function: {
            name: d.function?.name ?? '',
            arguments: '',
          },
          ...(toolInfo != null ? { toolInfo } : {}),
        };
        base.toolCalls[d.index] = tc;
      }
      if (d.id) {
        tc.id = d.id;
      }
      if (d.type) {
        tc.type = d.type;
      }
      if (d.function?.name) {
        tc.function.name = d.function.name;
      }
      if (d.function?.arguments) {
        tc.function.arguments += d.function.arguments;
      }
      const toolInfo = asToolInfo(d.toolInfo);
      if (toolInfo != null) {
        tc.toolInfo = toolInfo;
      }
      if (d.providerSpecificFields) {
        tc.providerSpecificFields = {
          ...(tc.providerSpecificFields ?? {}),
          ...d.providerSpecificFields,
        };
      }
    }
  }

  if (delta.finishReason) {
    base.finishReason = delta.finishReason;
  }
  if (delta.reasoningContent) {
    base.reasoningContent = (base.reasoningContent ?? '') + delta.reasoningContent;
  }
  if (delta.usage) {
    base.usage = delta.usage;
  }
}
