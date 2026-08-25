#!/usr/bin/env python3
"""Code Mode UDS client — same public surface as product mcp_client.py, stdlib only.

Authoritative reference (do not diverge on API/CLI/policy semantics):
  packages/trueforge-core/src/core/sandbox/scripts/mcp_client.py

Inlined into TypeScript via scripts/generate-local-sandbox-scripts.mjs
(src/sandbox/local/sandboxScripts.gen.ts), same pattern as core sandboxScripts.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import socket
import sys
import time
from pathlib import Path
from typing import Any, TypedDict

logger = logging.getLogger(__name__)

MAX_MESSAGE_BYTES = 64 * 1024 * 1024
_TOOLS_CACHE_TTL_SECONDS = 600


class _ServerConfig(TypedDict):
    allowed_tools: list[str]


_inflight_list_tools: dict[str, asyncio.Task[list[dict[str, Any]]]] = {}

_raw_servers = os.environ.get("TFY_MCP_SERVERS")
_servers_map: dict[str, _ServerConfig] = (
    json.loads(base64.b64decode(_raw_servers).decode()) if _raw_servers else {}
)
_enable_agent_approvals = os.environ.get("TFY_ENABLE_AGENT_APPROVALS", "true").lower() == "true"


def _sock_path() -> str:
    path = os.environ.get("TFY_MCP_SOCK")
    if not path:
        raise RuntimeError("TFY_MCP_SOCK is not set")
    return path


def _request_timeout() -> float:
    return float(os.environ.get("TFY_CM_REQUEST_TIMEOUT_SECONDS", "60"))


def _check_tool_allowed(server: str, tool_name: str) -> None:
    server_config = _servers_map.get(server)
    if server_config is None:
        raise RuntimeError(f"Access denied: MCP server '{server}' is not available for this agent") from None
    server_tools = server_config.get("allowed_tools") or []
    if len(server_tools) > 0 and tool_name not in server_tools:
        raise RuntimeError(f"Access denied: tool '{tool_name}' is not enabled on server '{server}'") from None


def _cache_path(server: str) -> Path:
    return Path(__file__).parent / f"{server}.tools.json"


def _read_tools_cache(server: str) -> list[dict[str, Any]] | None:
    p = _cache_path(server)
    if not p.exists():
        return None
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("cache root must be object")
        fetched_at = raw.get("fetched_at")
        tools = raw.get("tools")
        if not isinstance(fetched_at, (int, float)) or not isinstance(tools, list):
            raise ValueError("cache shape invalid")
        if time.time() - float(fetched_at) > _TOOLS_CACHE_TTL_SECONDS:
            p.unlink(missing_ok=True)
            return None
        return [t for t in tools if isinstance(t, dict)]
    except Exception:
        logger.exception("_read_tools_cache")
        p.unlink(missing_ok=True)
        return None


def _write_tools_cache(server: str, tools: list[dict[str, Any]]) -> None:
    try:
        payload = {"fetched_at": time.time(), "tools": tools}
        _cache_path(server).write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        logger.exception("_write_tools_cache")


def _read_message(sock: socket.socket) -> Any:
    body = b""
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        body += chunk
        if len(body) > MAX_MESSAGE_BYTES:
            raise RuntimeError(f"message exceeds max {MAX_MESSAGE_BYTES} bytes")
    return json.loads(body.decode("utf-8"))


def _write_message(sock: socket.socket, value: Any) -> None:
    sock.sendall(json.dumps(value).encode("utf-8"))


def _uds_request_sync(payload: dict[str, Any]) -> Any:
    """Connect → JSON request → write-close → JSON reply (no request_id)."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.settimeout(_request_timeout())
        sock.connect(_sock_path())
        _write_message(sock, payload)
        sock.shutdown(socket.SHUT_WR)
        reply = _read_message(sock)
    finally:
        sock.close()
    if not isinstance(reply, dict):
        raise RuntimeError(f"Code Mode reply is not an object: {reply!r}")
    ok = reply.get("ok")
    if ok is not True:
        source = reply.get("source", "internal")
        error = reply.get("error", "unknown error")
        if source == "caller":
            raise RuntimeError(f"Invalid MCP request: {error}")
        if source == "transport":
            raise RuntimeError(f"Code Mode transport error: {error}")
        raise RuntimeError(f"Internal MCP error: {error}")
    return reply.get("result")


async def _uds_request(payload: dict[str, Any]) -> Any:
    return await asyncio.to_thread(_uds_request_sync, payload)


async def _fetch_tools(server: str) -> list[dict[str, Any]]:
    result = await _uds_request({"op": "list_tools", "server": server})
    if not isinstance(result, dict):
        raise RuntimeError(f"list_tools '{server}' returned unexpected shape: {result!r}") from None
    tools = result.get("tools", [])
    if not isinstance(tools, list):
        raise RuntimeError(f"list_tools '{server}' tools is not a list: {tools!r}") from None
    return [t for t in tools if isinstance(t, dict)]


async def _fetch_and_cache_tools(server: str) -> list[dict[str, Any]]:
    tools = await _fetch_tools(server)
    _write_tools_cache(server, tools)
    return tools


async def _get_tools(server: str) -> list[dict[str, Any]]:
    cached = _read_tools_cache(server)
    if cached is not None:
        return cached
    task = _inflight_list_tools.get(server)
    if task is None:
        task = asyncio.create_task(_fetch_and_cache_tools(server))
        _inflight_list_tools[server] = task
        task.add_done_callback(lambda _t: _inflight_list_tools.pop(server, None))
    return await task


async def _get_tool(server: str, tool_name: str) -> dict[str, Any] | None:
    for t in await _get_tools(server):
        if t.get("name") == tool_name:
            return t
    return None


def _is_destructive(tool: dict[str, Any]) -> bool:
    annotations = tool.get("annotations")
    if annotations is None:
        return False
    if not isinstance(annotations, dict):
        return False
    destructive = annotations.get("destructiveHint")
    read_only = annotations.get("readOnlyHint")
    return bool(destructive) or (not read_only and read_only is not None)


async def _ensure_non_destructive(server: str, tool_name: str) -> None:
    tool = await _get_tool(server, tool_name)
    if tool is None:
        raise RuntimeError(f"Tool '{tool_name}' not found on MCP server '{server}'") from None
    if _is_destructive(tool):
        raise RuntimeError(
            f"Tool '{tool_name}' on MCP server '{server}' is destructive and cannot be called in Code Mode; "
            f"call it directly so it can go through the user approval flow"
        ) from None


def _project_call_tool_result(server: str, tool: str, result: Any) -> Any:
    """Project an MCP-wire CallToolResult-shaped object into the user-facing Python value."""
    if not isinstance(result, dict):
        raise RuntimeError(f"call_tool reply for '{server}/{tool}' is malformed: expected object") from None

    if result.get("isError"):
        content = result.get("content")
        text_parts: list[str] = []
        if isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    text = c.get("text")
                    if isinstance(text, str) and text:
                        text_parts.append(text)
        msg = "; ".join(text_parts) if text_parts else "tool returned an error"
        raise RuntimeError(f"MCP tool error (server={server}, tool={tool}): {msg}") from None

    if result.get("structuredContent") is not None:
        return result["structuredContent"]

    content = result.get("content")
    if isinstance(content, list) and len(content) == 1:
        first = content[0]
        if isinstance(first, dict) and first.get("type") == "text":
            text = first.get("text")
            if isinstance(text, str) and text:
                try:
                    return json.loads(text)
                except Exception:
                    pass
    if isinstance(content, list) and content:
        return content
    return None


async def call_tool(server: str, tool: str, body: dict[str, Any]) -> Any:
    _check_tool_allowed(server, tool)
    if _enable_agent_approvals:
        await _ensure_non_destructive(server, tool)

    raw = await _uds_request(
        {
            "op": "call_tool",
            "server": server,
            "tool": tool,
            "arguments": body,
        },
    )
    return _project_call_tool_result(server, tool, raw)


_USAGE = "mcp_client_local.py call-tool <server> <tool> <args-json>"


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mcp_client_local.py", usage=_USAGE)
    sub = parser.add_subparsers(dest="cmd", required=True)

    call_tool_p = sub.add_parser("call-tool", help="Invoke an MCP tool")
    call_tool_p.add_argument("server")
    call_tool_p.add_argument("tool")
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
