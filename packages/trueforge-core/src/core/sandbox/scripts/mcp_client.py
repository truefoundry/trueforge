#!/usr/bin/env python3

# /// script
# dependencies = ["mcp==1.29.0", "pydantic==2.12.5", "nats-py==2.15.0"]
# ///

import os
import sys
import json
import time
import base64
import asyncio
import logging
import argparse
from pathlib import Path
from typing import Any, TypedDict

from pydantic import BaseModel, ValidationError

from mcp.types import CallToolResult, TextContent, Tool

logger = logging.getLogger(__name__)

_NATS_REQUEST_MAX_ATTEMPTS = 3
_NATS_RETRY_BACKOFF_MS = 250

_nats_url = os.environ.get("TFY_NATS_URL")
_nats_subject_prefix = os.environ.get("TFY_NATS_SUBJECT_PREFIX")
_NATS_SUBJECT = f"{_nats_subject_prefix}.mcp" if _nats_url and _nats_subject_prefix else None
if bool(_nats_url) != bool(_nats_subject_prefix):
    raise RuntimeError(
        "TFY_NATS_URL and TFY_NATS_SUBJECT_PREFIX must be set together; "
        f"got TFY_NATS_URL={'set' if _nats_url else 'unset'}, "
        f"TFY_NATS_SUBJECT_PREFIX={'set' if _nats_subject_prefix else 'unset'}"
    ) from None

_nats_trace_headers: dict[str, str] = {}
if _traceparent := os.environ.get("TFY_TRACEPARENT"):
    _nats_trace_headers["traceparent"] = _traceparent
if _tracestate := os.environ.get("TFY_TRACESTATE"):
    _nats_trace_headers["tracestate"] = _tracestate


class _ToolsCache(BaseModel):
    fetched_at: float
    tools: list[Tool]


class _BridgeReply(BaseModel):
    """NATS bridge reply envelope. `result` is left untyped — operation-specific callers
    (Tool / CallToolResult) validate the payload; this model only validates the envelope."""

    ok: bool
    result: Any = None
    error: str = "unknown error"
    source: str = "internal"


class _ServerConfig(TypedDict):
    allowed_tools: list[str]


_TOOLS_CACHE_TTL_SECONDS = 600

_inflight_list_tools: dict[str, asyncio.Task[list[Tool]]] = {}

_raw_servers = os.environ.get("TFY_MCP_SERVERS")
_servers_map: dict[str, _ServerConfig] = json.loads(base64.b64decode(_raw_servers).decode()) if _raw_servers else {}
# Approvals are always enabled (Sandbox always injects TFY_ENABLE_AGENT_APPROVALS=true).
_enable_agent_approvals = os.environ.get("TFY_ENABLE_AGENT_APPROVALS", "true").lower() == "true"


def _check_tool_allowed(server: str, tool_name: str) -> None:
    server_config = _servers_map.get(server)
    if server_config is None:
        raise RuntimeError(f"Access denied: MCP server '{server}' is not available for this agent") from None
    server_tools = server_config.get("allowed_tools") or []
    if len(server_tools) > 0 and tool_name not in server_tools:
        raise RuntimeError(f"Access denied: tool '{tool_name}' is not enabled on server '{server}'") from None


def _cache_path(server: str) -> Path:
    return Path(__file__).parent / f"{server}.tools.json"


def _read_tools_cache(server: str) -> _ToolsCache | None:
    p = _cache_path(server)
    if not p.exists():
        return None
    try:
        cache = _ToolsCache.model_validate_json(p.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("_ToolsCache.model_validate_json")
        p.unlink(missing_ok=True)
        return None
    if time.time() - cache.fetched_at > _TOOLS_CACHE_TTL_SECONDS:
        p.unlink(missing_ok=True)
        return None
    return cache


def _write_tools_cache(server: str, tools: list[Tool]) -> None:
    try:
        cache = _ToolsCache(fetched_at=time.time(), tools=tools)
        _cache_path(server).write_text(cache.model_dump_json(), encoding="utf-8")
    except Exception:
        logger.exception("_write_tools_cache")


def _require_nats_subject() -> str:
    if not _NATS_SUBJECT or not _nats_url:
        raise RuntimeError(
            "NATS bridge setup failed; NATS bridge is required for MCP from Code Mode. "
            "Try again."
        ) from None
    return _NATS_SUBJECT


async def _fetch_tools(server: str) -> list[Tool]:
    result = await _nats_request(_require_nats_subject(), {"op": "list_tools", "server": server})
    if not isinstance(result, dict):
        raise RuntimeError(f"NATS list_tools '{server}' returned unexpected shape: {result!r}") from None
    return [Tool.model_validate(t) for t in result.get("tools", [])]


async def _fetch_and_cache_tools(server: str) -> list[Tool]:
    tools = await _fetch_tools(server)
    _write_tools_cache(server, tools)
    return tools


async def _nats_request(subject: str, payload: dict[str, Any]) -> Any:
    """Send one request over a short-lived bridge connection, unwrap { ok, result|error }.

    Connection is per-call (closed in `finally`) to avoid leaking nats-py's aiohttp session.
    Connect and request are retried in separate loops so a successful connection isn't torn
    down and rebuilt on a request-level retry. Retries only failures that prove the request
    never reached a handler (connect failure, NoRespondersError); timeouts and post-delivery
    failures are not retried so a non-idempotent tool can't double-execute.
    """
    import nats
    from nats.errors import NoRespondersError

    data = json.dumps(payload).encode()
    request_timeout = float(os.environ["TFY_CM_REQUEST_TIMEOUT_SECONDS"])

    # Phase 1: establish a connection, retrying only connect failures.
    nc = None
    last_connect_error = "unknown error"
    for attempt in range(1, _NATS_REQUEST_MAX_ATTEMPTS + 1):
        if attempt > 1:
            await asyncio.sleep(_NATS_RETRY_BACKOFF_MS / 1000)
        try:
            nc = await nats.connect(_nats_url)
            break
        except Exception as e:
            last_connect_error = f"connect to NATS at {_nats_url} failed: {e}"
    if nc is None:
        raise RuntimeError(
            f"NATS connect failed for '{subject}' after {_NATS_REQUEST_MAX_ATTEMPTS} attempts: {last_connect_error}"
        ) from None

    # Phase 2: request over the established connection, retrying only NoRespondersError.
    try:
        last_transport_error = "unknown error"
        for attempt in range(1, _NATS_REQUEST_MAX_ATTEMPTS + 1):
            if attempt > 1:
                await asyncio.sleep(_NATS_RETRY_BACKOFF_MS / 1000)
            try:
                msg = await nc.request(
                    subject,
                    data,
                    timeout=request_timeout,
                    headers=_nats_trace_headers or None,
                )
            except NoRespondersError as e:
                # Server confirms no subscriber — never delivered, safe to retry.
                last_transport_error = f"no NATS responder for '{subject}': {e}"
                continue
            except Exception as e:
                # Timeout / other: the tool may already have run, so we must not retry.
                raise RuntimeError(f"NATS request '{subject}' failed: {e}") from None
            try:
                reply = _BridgeReply.model_validate_json(msg.data.decode())
            except ValidationError as e:
                raise RuntimeError(f"NATS reply on '{subject}' is malformed: {e}") from None
            if not reply.ok:
                # A well-formed reply means the transport worked; `source` says who's at fault.
                if reply.source == "caller":
                    raise RuntimeError(f"Invalid MCP request on '{subject}': {reply.error}") from None
                if reply.source == "transport":
                    raise RuntimeError(f"Code Mode transport error on '{subject}': {reply.error}") from None
                raise RuntimeError(f"Internal MCP error on '{subject}': {reply.error}") from None
            return reply.result
        raise RuntimeError(
            f"NATS bridge has no responder for '{subject}' after {_NATS_REQUEST_MAX_ATTEMPTS} attempts: {last_transport_error}"
        ) from None
    finally:
        try:
            await nc.close()
        except Exception:
            logger.debug("Error closing NATS connection", exc_info=True)


async def _get_tools(server: str) -> list[Tool]:
    cache = _read_tools_cache(server)
    if cache is not None:
        return cache.tools
    task = _inflight_list_tools.get(server)
    if task is None:
        task = asyncio.create_task(_fetch_and_cache_tools(server))
        _inflight_list_tools[server] = task
        task.add_done_callback(lambda _t: _inflight_list_tools.pop(server, None))
    return await task


async def _get_tool(server: str, tool_name: str) -> Tool | None:
    for t in await _get_tools(server):
        if t.name == tool_name:
            return t
    return None


def _is_destructive(tool: Tool) -> bool:
    annotations = tool.annotations
    if annotations is None:
        return False
    return bool(annotations.destructiveHint) or (not annotations.readOnlyHint and annotations.readOnlyHint is not None)

async def _ensure_non_destructive(server: str, tool_name: str) -> None:
    tool = await _get_tool(server, tool_name)
    if tool is None:
        raise RuntimeError(f"Tool '{tool_name}' not found on MCP server '{server}'") from None
    if _is_destructive(tool):
        raise RuntimeError(
            f"Tool '{tool_name}' on MCP server '{server}' is destructive and cannot be called in Code Mode; "
            f"call it directly so it can go through the user approval flow"
        ) from None


def _project_call_tool_result(server: str, tool: str, result: CallToolResult) -> Any:
    """Project an MCP-wire CallToolResult into the user-facing Python value."""
    if result.isError:
        text_parts = [c.text for c in result.content if isinstance(c, TextContent) and c.text]
        msg = "; ".join(text_parts) if text_parts else "tool returned an error"
        raise RuntimeError(f"MCP tool error (server={server}, tool={tool}): {msg}") from None

    if result.structuredContent is not None:
        return result.structuredContent

    # Fallback to content blocks (tools without outputSchema / plain text responses)
    if len(result.content) == 1:
        first = result.content[0]
        if isinstance(first, TextContent) and first.text:
            try:
                return json.loads(first.text)
            except Exception:
                pass
    if result.content:
        return result.content
    return None


async def call_tool(server: str, tool: str, body: dict[str, Any]) -> Any:
    _check_tool_allowed(server, tool)
    if _enable_agent_approvals:
        await _ensure_non_destructive(server, tool)

    raw = await _nats_request(
        _require_nats_subject(),
        {"op": "call_tool", "server": server, "tool": tool, "arguments": body},
    )
    try:
        result = CallToolResult.model_validate(raw)
    except Exception as e:
        raise RuntimeError(f"NATS call_tool reply for '{server}/{tool}' is malformed: {e}") from None

    return _project_call_tool_result(server, tool, result)


_USAGE = "mcp_client.py call-tool <server> <tool> <args-json>"


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mcp_client.py", usage=_USAGE)
    sub = parser.add_subparsers(dest="cmd", required=True)

    call_tool_p = sub.add_parser("call-tool", help="Invoke an MCP tool")
    call_tool_p.add_argument("server")
    call_tool_p.add_argument("tool")
    # Parsing JSON at the argparse boundary surfaces malformed input as a clean
    # argparse error (with usage) instead of an opaque traceback from inside the handler.
    call_tool_p.add_argument("args_json", metavar="args-json", type=json.loads)

    return parser


async def _main() -> None:
    args = _build_arg_parser().parse_args()
    try:
        if args.cmd == "call-tool":
            result = await call_tool(args.server, args.tool, args.args_json)
            print(json.dumps(result, default=str))
    except RuntimeError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    asyncio.run(_main())
