import type * as TrueForge from "../../src/api/index";
import { isEventDelta, mergeEventDelta } from "../../src/events";

function baseMessage(overrides: Partial<TrueForge.ModelMessageEvent> = {}): TrueForge.ModelMessageEvent {
    return {
        type: "model.message",
        id: "msg-1",
        threadId: "main",
        createdAt: "2026-06-24T10:00:00Z",
        content: "",
        ...overrides,
    };
}

function delta(overrides: Partial<TrueForge.ModelMessageDeltaEvent> = {}): TrueForge.ModelMessageDeltaEvent {
    return {
        type: "model.message.delta",
        id: "msg-1",
        threadId: "main",
        ...overrides,
    };
}

describe("isEventDelta", () => {
    it("returns true for model.message.delta", () => {
        expect(isEventDelta(delta())).toBe(true);
    });

    it("returns false for other event types", () => {
        expect(isEventDelta(baseMessage())).toBe(false);
        expect(isEventDelta({ type: "turn.done" })).toBe(false);
    });
});

describe("mergeEventDelta", () => {
    it("appends content and reasoningContent", () => {
        const base = baseMessage({ content: "Hel", reasoningContent: "think" });
        mergeEventDelta(base, delta({ content: "lo", reasoningContent: "ing" }));
        expect(base.content).toBe("Hello");
        expect(base.reasoningContent).toBe("thinking");
    });

    it("treats null/undefined content as empty string when appending", () => {
        const base = baseMessage({ content: null });
        mergeEventDelta(base, delta({ content: "Hi" }));
        expect(base.content).toBe("Hi");
    });

    it("does not append string content onto array content", () => {
        const parts: TrueForge.ModelMessageEventContentOneItem[] = [{ type: "text", text: "x" }];
        const base = baseMessage({ content: parts });
        mergeEventDelta(base, delta({ content: "y" }));
        expect(base.content).toBe(parts);
    });

    it("overwrites finishReason, usage, and refusal", () => {
        const base = baseMessage({
            finishReason: null,
            refusal: null,
        });
        const usage: TrueForge.ModelMessageUsage = {
            inputTokens: 1,
            outputTokens: 2,
            inputTokensBreakdown: {
                harness: 0,
                instructions: 0,
                messages: 1,
                skills: 0,
                toolDefinitions: 0,
            },
        };
        mergeEventDelta(
            base,
            delta({
                finishReason: "stop",
                refusal: "nope",
                usage,
            }),
        );
        expect(base.finishReason).toBe("stop");
        expect(base.refusal).toBe("nope");
        expect(base.usage).toEqual(usage);
    });

    it("merges tool call fragments by index", () => {
        const base = baseMessage();
        const toolInfo: TrueForge.McpToolInfo = {
            type: "mcp",
            name: "get_order",
            serverId: "orders-api",
            serverName: "orders-api",
        };

        mergeEventDelta(
            base,
            delta({
                toolCalls: [
                    {
                        index: 0,
                        id: "call-1",
                        type: "function",
                        function: { name: "get_order", arguments: "" },
                        toolInfo,
                    },
                ],
            }),
        );
        mergeEventDelta(
            base,
            delta({
                toolCalls: [
                    {
                        index: 0,
                        function: { arguments: '{"order_id":' },
                    },
                ],
            }),
        );
        mergeEventDelta(
            base,
            delta({
                toolCalls: [
                    {
                        index: 0,
                        function: { arguments: '"ORD-2031"}' },
                    },
                ],
            }),
        );

        expect(base.toolCalls).toEqual([
            {
                id: "call-1",
                type: "function",
                function: { name: "get_order", arguments: '{"order_id":"ORD-2031"}' },
                toolInfo,
            },
        ]);
    });

    it("no-ops when ids do not match", () => {
        const base = baseMessage({ content: "keep" });
        mergeEventDelta(base, delta({ id: "other", content: "x" }));
        expect(base.content).toBe("keep");
    });

    it("no-ops when base is not a model.message", () => {
        const turnDone: TrueForge.TurnDoneEvent = {
            type: "turn.done",
            id: "msg-1",
            threadId: null,
            createdAt: "2026-06-24T10:00:00Z",
            state: { status: "done", output: null, requiredActions: [], completedAt: "2026-06-24T10:00:00Z" },
        };
        mergeEventDelta(turnDone, delta({ content: "x" }));
        expect(turnDone).toEqual({
            type: "turn.done",
            id: "msg-1",
            threadId: null,
            createdAt: "2026-06-24T10:00:00Z",
            state: { status: "done", output: null, requiredActions: [], completedAt: "2026-06-24T10:00:00Z" },
        });
    });
});
