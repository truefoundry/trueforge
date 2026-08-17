#!/usr/bin/env python3
"""Code Mode UDS client: connect to host socket, one JSON request/response per call."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sys
import time
from typing import Any

MAX_MESSAGE_BYTES = 64 * 1024 * 1024


def _sock_path() -> str:
    path = os.environ.get("TFY_MCP_SOCK")
    if not path:
        raise RuntimeError("TFY_MCP_SOCK is not set")
    return path


def _request_timeout() -> float:
    return float(os.environ.get("TFY_CM_REQUEST_TIMEOUT_SECONDS", "60"))


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


def _request_sync(payload: dict[str, Any]) -> Any:
    """Connect → JSON request → write-close → JSON reply → close (no request_id)."""
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
    if not reply.get("ok"):
        source = reply.get("source", "internal")
        error = reply.get("error", "unknown error")
        if source == "caller":
            raise RuntimeError(f"Invalid MCP request: {error}")
        if source == "transport":
            raise RuntimeError(f"Code Mode transport error: {error}")
        raise RuntimeError(f"Internal MCP error: {error}")
    return reply.get("result")


async def list_tools(server: str) -> Any:
    return await asyncio.to_thread(
        _request_sync,
        {"op": "list_tools", "server": server},
    )


async def call_tool(server: str, tool: str, body: dict[str, Any]) -> Any:
    return await asyncio.to_thread(
        _request_sync,
        {
            "op": "call_tool",
            "server": server,
            "tool": tool,
            "arguments": body,
        },
    )


async def _cmd_list_tools(server: str) -> None:
    await list_tools(server)
    print("list-tools-ok")


async def _cmd_call_tool(server: str, tool: str, args: dict[str, Any]) -> None:
    result = await call_tool(server, tool, args)
    print("call-tool-ok", json.dumps(result, default=str))


async def _cmd_multiplex(server: str, count: int) -> None:
    coros = [
        call_tool(server, "ping", {"message": f"m{i}", "delay_ms": 150})
        for i in range(count)
    ]
    started = time.monotonic()
    results = await asyncio.gather(*coros)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    print("multiplex-ok", elapsed_ms, json.dumps(results, default=str))


async def _async_main() -> None:
    parser = argparse.ArgumentParser(prog="mcp_pipe_client.py")
    sub = parser.add_subparsers(dest="cmd", required=True)

    list_p = sub.add_parser("list-tools", help="Invoke list_tools()")
    list_p.add_argument("--server", default="demo")

    call_p = sub.add_parser("call-tool", help="Invoke call_tool()")
    call_p.add_argument("--server", default="demo")
    call_p.add_argument("--tool", default="ping")
    call_p.add_argument("--args-json", default='{"message":"poc"}', type=json.loads)

    multi_p = sub.add_parser("multiplex", help="Concurrent call_tool via parallel UDS connects")
    multi_p.add_argument("--server", default="demo")
    multi_p.add_argument("--count", type=int, default=2)

    args = parser.parse_args()
    try:
        if args.cmd == "list-tools":
            await _cmd_list_tools(args.server)
            return
        if args.cmd == "multiplex":
            await _cmd_multiplex(args.server, args.count)
            return
        await _cmd_call_tool(args.server, args.tool, args.args_json)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(2) from e


def main() -> None:
    asyncio.run(_async_main())


if __name__ == "__main__":
    main()
