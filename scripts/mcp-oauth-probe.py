"""Programmatic TF gateway MCP probe: Bearer inbound token + McpAuthRequiredError.

This is the TrueForge mid-turn shape (not Cursor auth=oauth):
  Authorization: Bearer <user_token>
  → on missing outbound OAuth, gateway returns 401 JSON:
      { "error": { "type": "McpAuthRequiredError" }, "authorization_urls": {...}, ... }

Requires: mcp + httpx2
  /Users/chiragjn/venv311/bin/python -m pip install -U 'mcp' 'httpx2'

Usage:
  export TFY_TOKEN='<PAT or IdP JWT>'
  /Users/chiragjn/venv311/bin/python scripts/mcp-oauth-probe.py

  MCP_URL=https://…/mcp/pylon/server TFY_TOKEN=… \\
    /Users/chiragjn/venv311/bin/python scripts/mcp-oauth-probe.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import webbrowser
from typing import Any

import httpx2
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client

MCP_URL = os.environ.get(
    "MCP_URL",
    "https://internal.devtest.truefoundry.tech/api/llm/truefoundry/mcp/pylon/server",
)
TFY_TOKEN = os.environ.get("TFY_DEVTEST_CHIRAG_KEY") or os.environ.get("USER_TOKEN") or ""
OPEN_AUTH_URL = os.environ.get("OPEN_AUTH_URL", "1") not in ("0", "false", "False")
# Token Forwarding / per-request upstream overrides (gateway reads this JSON header).
TFY_MCP_HEADERS = os.environ.get("TFY_MCP_HEADERS", '{"Authorization": "test"}')


def request_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        # "x-tfy-mcp-headers": TFY_MCP_HEADERS,
    }


def parse_mcp_auth_required(body: Any) -> dict[str, Any] | None:
    """Return a normalized auth-required payload, or None if body is something else."""
    if not isinstance(body, dict):
        return None

    # Docs shape: error.type == McpAuthRequiredError + authorization_urls
    error = body.get("error")
    error_type = error.get("type") if isinstance(error, dict) else body.get("type")
    urls = body.get("authorization_urls")
    if urls is None and isinstance(error, dict):
        urls = error.get("authorization_urls")

    if error_type == "McpAuthRequiredError" or (isinstance(urls, dict) and urls):
        return {
            "auth_required": True,
            "error_type": error_type,
            "authorization_urls": urls if isinstance(urls, dict) else {},
            "server_names": body.get("server_names") or {},
            "message": body.get("message") or (error.get("message") if isinstance(error, dict) else "") or "",
            "raw": body,
        }
    return None


async def probe_raw_initialize(mcp_url: str, token: str) -> dict[str, Any]:
    """POST a minimal MCP initialize so we can see the raw 401 JSON body."""
    headers = {
        **request_headers(token),
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
    }
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "trueforge-mcp-oauth-probe", "version": "0.0.1"},
        },
    }

    async with httpx2.AsyncClient(follow_redirects=True, timeout=60.0) as http:
        response = await http.post(mcp_url, headers=headers, json=payload)
        text = response.text
        try:
            body: Any = response.json()
        except Exception:
            body = None

        print("--- raw initialize ---")
        print(f"status={response.status_code}")
        print(f"www-authenticate={response.headers.get('www-authenticate')!r}")
        print(f"content-type={response.headers.get('content-type')!r}")
        if body is not None:
            print("body=", json.dumps(body, indent=2))
        else:
            print("body_text=", text[:4000])

        auth = parse_mcp_auth_required(body) if body is not None else None
        return {
            "status": response.status_code,
            "body": body,
            "text": text,
            "auth": auth,
            "www_authenticate": response.headers.get("www-authenticate"),
        }


def make_http_client(**kwargs: Any) -> httpx2.AsyncClient:
    """Ensure 4xx bodies are read (MCP streaming can otherwise drop them)."""

    async def _read_error_body(response: httpx2.Response) -> None:
        if response.status_code >= 400:
            await response.aread()

    hooks = kwargs.pop("event_hooks", {})
    hooks.setdefault("response", []).append(_read_error_body)
    return httpx2.AsyncClient(event_hooks=hooks, follow_redirects=True, timeout=60.0, **kwargs)


async def probe_mcp_session(mcp_url: str, token: str) -> dict[str, Any]:
    async with make_http_client(headers=request_headers(token)) as http:
        try:
            async with streamable_http_client(mcp_url, http_client=http) as streams:
                read, write = streams[0], streams[1]
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    names = [t.name for t in tools.tools]
                    print("--- mcp session ---")
                    print("ok; tools:", names)
                    return {"success": True, "tools": names}
        except httpx2.HTTPStatusError as exc:
            body: Any
            try:
                body = exc.response.json()
            except Exception:
                body = {"_text": exc.response.text}
            print("--- mcp session HTTPStatusError ---")
            print(f"status={exc.response.status_code}")
            print("body=", json.dumps(body, indent=2) if not isinstance(body, dict) or "_text" not in body else body)
            auth = parse_mcp_auth_required(body)
            if auth is not None:
                return {"success": False, **auth}
            raise
        except Exception as exc:
            print("--- mcp session error ---")
            print(f"{type(exc).__name__}: {exc}")
            # Fall back to raw probe details already printed by caller.
            return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


async def main() -> None:
    if not TFY_TOKEN:
        print("Set TFY_TOKEN (or USER_TOKEN) to a TrueFoundry PAT / IdP JWT / virtual-account token.", file=sys.stderr)
        print("Example:", file=sys.stderr)
        print("  export TFY_TOKEN='…'", file=sys.stderr)
        print("  /Users/chiragjn/venv311/bin/python scripts/mcp-oauth-probe.py", file=sys.stderr)
        sys.exit(2)

    print(f"MCP_URL={MCP_URL}")
    print(f"TFY_TOKEN=***{TFY_TOKEN[-6:]}" if len(TFY_TOKEN) > 6 else "TFY_TOKEN=***")
    print(f"x-tfy-mcp-headers={TFY_MCP_HEADERS}")

    raw = await probe_raw_initialize(MCP_URL, TFY_TOKEN)
    if raw["auth"] is not None:
        auth = raw["auth"]
        print("--- McpAuthRequiredError (from raw initialize) ---")
        print("message:", auth.get("message") or "(none)")
        urls = auth.get("authorization_urls") or {}
        if not urls:
            print("authorization_urls: (empty)")
        for server, url in urls.items():
            print(f"  authorize {server}: {url}")
            if OPEN_AUTH_URL and isinstance(url, str) and url.startswith("http"):
                print("  opening browser…")
                webbrowser.open(url)
        print("Complete consent in the browser, then re-run this script.")
        return

    if raw["status"] == 401:
        print("Got 401 but not McpAuthRequiredError — likely inbound auth failure or unexpected shape.")
        if raw.get("www_authenticate"):
            print("This looks like inbound WWW-Authenticate (Cursor auth=oauth territory), not outbound consent.")
        sys.exit(1)

    result = await probe_mcp_session(MCP_URL, TFY_TOKEN)
    if result.get("auth_required"):
        print("--- McpAuthRequiredError (from MCP session) ---")
        print("message:", result.get("message") or "(none)")
        for server, url in (result.get("authorization_urls") or {}).items():
            print(f"  authorize {server}: {url}")
            if OPEN_AUTH_URL and isinstance(url, str) and url.startswith("http"):
                webbrowser.open(url)
        print("Complete consent in the browser, then re-run this script.")
        return

    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
