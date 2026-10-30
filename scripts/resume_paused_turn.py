#!/usr/bin/env python3
"""Resume a paused turn: open subscribe, send inbound event(s), print until turn.done.

A live pause stays on the same turn (`turn.update` status=paused).
`subscribe_to_turn` is transport reconnect; `create_turn_events` wakes execution
(including after pause offload).

Usage:
  export TRUEFORGE_BASE_URL=http://localhost:8790
  # export TRUEFORGE_TOKEN=...
  export TRUEFORGE_SESSION_ID=sess_...
  export TRUEFORGE_TURN_ID=turn_...
  # optional: RESUME_MODE=approval|tool_response|mcp_auth_continue
  # optional: TRUEFORGE_TOOL_CALL_ID=... / TRUEFORGE_THREAD_ID=main

  pip install trueforge-sdk
  python scripts/resume_paused_turn.py
"""

from __future__ import annotations

import os
import sys
from typing import Any

from trueforge_sdk import TrueForge


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"Missing required env var: {name}")
    return value


def _pending_resume_events(events: list[Any]) -> list[dict[str, Any]]:
    mode = os.environ.get("RESUME_MODE", "auto").strip().lower()

    if mode == "mcp_auth_continue":
        return [{"type": "user.mcp_auth_continue"}]

    if mode == "approval":
        decision = os.environ.get("TRUEFORGE_APPROVAL", "allow").strip().lower()
        approval: dict[str, Any] = (
            {"status": "allow"}
            if decision == "allow"
            else {"status": "deny", "reason": os.environ.get("TRUEFORGE_DENY_REASON", "denied by script")}
        )
        return [
            {
                "type": "user.tool_approval",
                "thread_id": os.environ.get("TRUEFORGE_THREAD_ID", "main"),
                "tool_call_id": _env("TRUEFORGE_TOOL_CALL_ID"),
                "approval": approval,
            }
        ]

    if mode == "tool_response":
        return [
            {
                "type": "user.tool_response",
                "thread_id": os.environ.get("TRUEFORGE_THREAD_ID", "main"),
                "tool_call_id": _env("TRUEFORGE_TOOL_CALL_ID"),
                "content": os.environ.get("TRUEFORGE_TOOL_RESPONSE", "ok"),
            }
        ]

    for event in reversed(events):
        if event.type == "mcp.auth_required":
            return [{"type": "user.mcp_auth_continue"}]
        if event.type == "tool.approval_required" and event.tool_calls:
            ref = event.tool_calls[0]
            return [
                {
                    "type": "user.tool_approval",
                    "thread_id": event.thread_id,
                    "tool_call_id": ref.id,
                    "approval": {"status": "allow"},
                }
            ]
        if event.type == "tool.response_required" and event.tool_calls:
            ref = event.tool_calls[0]
            return [
                {
                    "type": "user.tool_response",
                    "thread_id": event.thread_id,
                    "tool_call_id": ref.id,
                    "content": os.environ.get("TRUEFORGE_TOOL_RESPONSE", "ok"),
                }
            ]

    raise SystemExit(
        "Could not infer a resume event from turn history. "
        "Set RESUME_MODE=approval|tool_response|mcp_auth_continue and the matching IDs."
    )


def main() -> None:
    session_id = _env("TRUEFORGE_SESSION_ID")
    turn_id = _env("TRUEFORGE_TURN_ID")
    after_raw = os.environ.get("TRUEFORGE_AFTER_SEQUENCE_NUMBER")
    after_sequence_number = int(after_raw) if after_raw not in (None, "") else None

    client = TrueForge(
        base_url=os.environ.get("TRUEFORGE_BASE_URL", "http://localhost:8790"),
        token=os.environ.get("TRUEFORGE_TOKEN"),
        timeout=600,
    )

    turn = client.sessions.get_turn(session_id=session_id, turn_id=turn_id).data
    if turn.state.status != "paused":
        print(f"warning: expected paused, got {turn.state.status!r}", file=sys.stderr)

    # Cold load: event ids already on disk. Subscribe may replay them; skip those.
    listed = list(
        client.sessions.list_turn_events(
            session_id=session_id,
            turn_id=turn_id,
            order="asc",
        )
    )
    seen_ids = {event.id for event in listed}
    resume_events = _pending_resume_events(listed)

    with client.sessions.subscribe_to_turn(
        session_id=session_id,
        turn_id=turn_id,
        after_sequence_number=after_sequence_number,
        request_options={"timeout": 600},
    ) as stream:
        client.sessions.create_turn_events(
            session_id=session_id,
            turn_id=turn_id,
            events=resume_events,
        )

        for event in stream:
            # Listed events are fully accumulated — ignore replayed bases and their deltas.
            if event.id in seen_ids:
                continue

            match event.type:
                case "model.message.delta":
                    print(event.content or "", end="", flush=True)
                case "turn.update":
                    print(f"\n[{event.type}] status={event.state.status}")
                case "tool.approval_required" | "tool.response_required":
                    print(f"\n[{event.type}] tool_calls={[ref.id for ref in event.tool_calls]}")
                case "mcp.auth_required":
                    print(f"\n[{event.type}] servers={[s.name for s in event.mcp_servers]}")
                case "turn.done":
                    print(f"\n[{event.type}] status={event.state.status}")
                    break
                case _:
                    print(f"\n[{event.type}]")


if __name__ == "__main__":
    main()
