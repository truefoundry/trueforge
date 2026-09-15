from __future__ import annotations

import typing

from .types.chat_completion_message_tool_call_function import ChatCompletionMessageToolCallFunction
from .types.extended_chunk_delta_tool_call import ExtendedChunkDeltaToolCall
from .types.model_message_delta_event import ModelMessageDeltaEvent
from .types.model_message_event import ModelMessageEvent
from .types.tool_call import ToolCall
from .types.turn_streaming_event import TurnStreamingEvent


def is_event_delta(event: object) -> typing.TypeGuard[ModelMessageDeltaEvent]:
    return getattr(event, "type", None) == "model.message.delta"


def merge_event_delta(
    base: TurnStreamingEvent | ModelMessageEvent,
    delta: ModelMessageDeltaEvent,
) -> None:
    """Merge a `model.message.delta` into its matching `model.message` in place."""
    if base.type != "model.message":
        return
    if base.id != delta.id:
        return

    if delta.content is not None and len(delta.content) > 0:
        if base.content is None or isinstance(base.content, str):
            base.content = f"{base.content or ''}{delta.content}"

    if delta.reasoning_content is not None and len(delta.reasoning_content) > 0:
        base.reasoning_content = f"{base.reasoning_content or ''}{delta.reasoning_content}"

    if delta.refusal is not None:
        base.refusal = delta.refusal

    if delta.finish_reason is not None:
        base.finish_reason = delta.finish_reason

    if delta.usage is not None:
        base.usage = delta.usage

    if delta.tool_calls is not None and len(delta.tool_calls) > 0:
        if base.tool_calls is None:
            base.tool_calls = []
        for delta_tool_call in delta.tool_calls:
            _merge_tool_call_delta(base.tool_calls, delta_tool_call)


def _merge_tool_call_delta(
    tool_calls: list[ToolCall],
    delta_tool_call: ExtendedChunkDeltaToolCall,
) -> None:
    index = delta_tool_call.index
    if index < len(tool_calls):
        existing = tool_calls[index]
        if delta_tool_call.id is not None:
            existing.id = delta_tool_call.id
        if delta_tool_call.tool_info is not None:
            existing.tool_info = delta_tool_call.tool_info
        if delta_tool_call.provider_specific_fields is not None:
            existing.provider_specific_fields = delta_tool_call.provider_specific_fields
        if delta_tool_call.function is not None:
            if delta_tool_call.function.name is not None:
                existing.function.name = delta_tool_call.function.name
            if delta_tool_call.function.arguments is not None:
                existing.function.arguments += delta_tool_call.function.arguments
        return

    # Streaming tool calls are emitted in index order; ignore sparse gaps.
    if index != len(tool_calls):
        return

    tool_id = delta_tool_call.id
    name = None if delta_tool_call.function is None else delta_tool_call.function.name
    tool_info = delta_tool_call.tool_info
    if tool_id is None or name is None or tool_info is None:
        return

    arguments = ""
    if delta_tool_call.function is not None and delta_tool_call.function.arguments is not None:
        arguments = delta_tool_call.function.arguments

    created = ToolCall(
        id=tool_id,
        type="function",
        function=ChatCompletionMessageToolCallFunction(name=name, arguments=arguments),
        tool_info=tool_info,
    )
    if delta_tool_call.provider_specific_fields is not None:
        created.provider_specific_fields = delta_tool_call.provider_specific_fields
    tool_calls.append(created)
