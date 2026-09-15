from trueforge_sdk import is_event_delta, merge_event_delta
from trueforge_sdk.types.chat_completion_chunk_delta_tool_call_function import (
    ChatCompletionChunkDeltaToolCallFunction,
)
from trueforge_sdk.types.chat_completion_content_part_text import ChatCompletionContentPartText
from trueforge_sdk.types.extended_chunk_delta_tool_call import ExtendedChunkDeltaToolCall
from trueforge_sdk.types.finish_reason import FinishReason
from trueforge_sdk.types.model_message_delta_event import ModelMessageDeltaEvent
from trueforge_sdk.types.model_message_event import ModelMessageEvent
from trueforge_sdk.types.true_foundry_system_tool_info import TrueFoundrySystemToolInfo
from trueforge_sdk.types.turn_created_event import TurnCreatedEvent
from trueforge_sdk.types.turn_state_running import TurnStateRunning


def _base(**overrides: object) -> ModelMessageEvent:
    fields: dict[str, object] = {
        "id": "msg-1",
        "created_at": "2026-01-01T00:00:00Z",
        "thread_id": "main",
        "type": "model.message",
    }
    fields.update(overrides)
    return ModelMessageEvent(**fields)


def _delta(**overrides: object) -> ModelMessageDeltaEvent:
    fields: dict[str, object] = {
        "id": "msg-1",
        "thread_id": "main",
        "type": "model.message.delta",
    }
    fields.update(overrides)
    return ModelMessageDeltaEvent(**fields)


def test_is_event_delta() -> None:
    assert is_event_delta(_delta())
    assert not is_event_delta(_base())


def test_merge_appends_content_and_reasoning() -> None:
    base = _base(content="Hel")
    merge_event_delta(base, _delta(content="lo", reasoning_content="think"))
    assert base.content == "Hello"
    assert base.reasoning_content == "think"


def test_merge_noops_on_id_or_type_mismatch() -> None:
    base = _base(content="Hel")
    merge_event_delta(base, _delta(id="other", content="lo"))
    assert base.content == "Hel"

    created = TurnCreatedEvent(
        id="t1",
        created_at="2026-01-01T00:00:00Z",
        turn_id="turn-1",
        state=TurnStateRunning(),
    )
    merge_event_delta(created, _delta(content="lo"))


def test_merge_tool_calls_by_index() -> None:
    base = _base()
    info = TrueFoundrySystemToolInfo(name="ask_user_question", type="truefoundry-system")
    merge_event_delta(
        base,
        _delta(
            tool_calls=[
                ExtendedChunkDeltaToolCall(
                    index=0,
                    id="call-1",
                    type="function",
                    function=ChatCompletionChunkDeltaToolCallFunction(name="ask_user_question", arguments='{"q":'),
                    tool_info=info,
                )
            ]
        ),
    )
    merge_event_delta(
        base,
        _delta(
            tool_calls=[
                ExtendedChunkDeltaToolCall(
                    index=0,
                    function=ChatCompletionChunkDeltaToolCallFunction(arguments='"hi"}'),
                )
            ]
        ),
    )
    assert base.tool_calls is not None
    assert len(base.tool_calls) == 1
    assert base.tool_calls[0].function.arguments == '{"q":"hi"}'


def test_merge_ignores_sparse_tool_call_index() -> None:
    base = _base()
    info = TrueFoundrySystemToolInfo(name="ask_user_question", type="truefoundry-system")
    merge_event_delta(
        base,
        _delta(
            tool_calls=[
                ExtendedChunkDeltaToolCall(
                    index=1,
                    id="call-2",
                    function=ChatCompletionChunkDeltaToolCallFunction(name="ask_user_question", arguments="{}"),
                    tool_info=info,
                )
            ]
        ),
    )
    assert base.tool_calls == []


def test_merge_does_not_append_to_content_parts() -> None:
    parts = [ChatCompletionContentPartText(text="Hel", type="text")]
    base = _base(content=parts)
    merge_event_delta(base, _delta(content="lo"))
    assert isinstance(base.content, list)
    assert base.content[0].text == "Hel"


def test_merge_overwrites_finish_reason_and_refusal() -> None:
    base = _base()
    merge_event_delta(base, _delta(finish_reason=FinishReason.STOP, refusal="no"))
    assert base.finish_reason == FinishReason.STOP
    assert base.refusal == "no"


def test_helpers_are_on_package_root() -> None:
    import trueforge_sdk

    assert trueforge_sdk.is_event_delta is is_event_delta
    assert trueforge_sdk.merge_event_delta is merge_event_delta
