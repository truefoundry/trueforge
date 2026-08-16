import type * as TrueForge from "./api/index.js";

/**
 * Returns true when `event` is a streaming delta that must be merged into a
 * base `model.message` with the same `id`.
 */
export function isEventDelta(event: { type: string }): event is TrueForge.ModelMessageDeltaEvent {
    return event.type === "model.message.delta";
}

/**
 * Merges a `model.message.delta` into its base `model.message` in place.
 *
 * Deltas and their base share an `id`. Content / reasoning text is appended;
 * tool-call fragments are merged by `index`; `finishReason`, `usage`, and
 * `refusal` overwrite when present on the delta.
 *
 * No-ops when `base` is not a `model.message` or the ids do not match.
 */
export function mergeEventDelta(
    base: TrueForge.TurnStreamingEvent | TrueForge.ModelMessageEvent,
    delta: TrueForge.ModelMessageDeltaEvent,
): void {
    if (base.type !== "model.message") {
        return;
    }
    if (base.id !== delta.id) {
        return;
    }

    if (delta.content != null && delta.content.length > 0) {
        if (base.content == null || typeof base.content === "string") {
            base.content = `${base.content ?? ""}${delta.content}`;
        }
    }

    if (delta.reasoningContent != null && delta.reasoningContent.length > 0) {
        base.reasoningContent = `${base.reasoningContent ?? ""}${delta.reasoningContent}`;
    }

    if (delta.refusal !== undefined) {
        base.refusal = delta.refusal;
    }

    if (delta.finishReason !== undefined) {
        base.finishReason = delta.finishReason;
    }

    if (delta.usage !== undefined) {
        base.usage = delta.usage;
    }

    if (delta.toolCalls != null && delta.toolCalls.length > 0) {
        if (base.toolCalls == null) {
            base.toolCalls = [];
        }
        for (const deltaToolCall of delta.toolCalls) {
            mergeToolCallDelta(base.toolCalls, deltaToolCall);
        }
    }
}

function mergeToolCallDelta(
    toolCalls: TrueForge.ToolCall[],
    deltaToolCall: TrueForge.ExtendedChunkDeltaToolCall,
): void {
    const { index } = deltaToolCall;
    const existing = toolCalls[index];

    if (existing !== undefined) {
        if (deltaToolCall.id !== undefined) {
            existing.id = deltaToolCall.id;
        }
        if (deltaToolCall.toolInfo !== undefined) {
            existing.toolInfo = deltaToolCall.toolInfo;
        }
        if (deltaToolCall.providerSpecificFields !== undefined) {
            existing.providerSpecificFields = deltaToolCall.providerSpecificFields;
        }
        if (deltaToolCall.function !== undefined) {
            if (deltaToolCall.function.name !== undefined) {
                existing.function.name = deltaToolCall.function.name;
            }
            if (deltaToolCall.function.arguments !== undefined) {
                existing.function.arguments += deltaToolCall.function.arguments;
            }
        }
        return;
    }

    // Only append sequentially — sparse / out-of-order indexes are ignored until
    // earlier slots exist (streaming tool calls are emitted in index order).
    if (index !== toolCalls.length) {
        return;
    }

    const id = deltaToolCall.id;
    const name = deltaToolCall.function?.name;
    const toolInfo = deltaToolCall.toolInfo;
    if (id === undefined || name === undefined || toolInfo === undefined) {
        return;
    }

    const created: TrueForge.ToolCall = {
        id,
        type: "function",
        function: {
            name,
            arguments: deltaToolCall.function?.arguments ?? "",
        },
        toolInfo,
    };
    if (deltaToolCall.providerSpecificFields !== undefined) {
        created.providerSpecificFields = deltaToolCall.providerSpecificFields;
    }
    toolCalls.push(created);
}
