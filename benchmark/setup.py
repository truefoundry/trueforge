#!/usr/bin/env python3
"""One-time setup for the CMA arm.

- CMA: creates a cloud environment, an agent (model = MODEL_CMA, system = the shipped
  system prompt, with the MCP servers attached as always-allow toolsets), and — if the
  servers need a bearer token — a vault with one static-bearer credential per server
  URL. Writes results/cma_ids.json {env_id, agent_id, vault_id}. Skips if that file
  already exists, so it is safe to rerun.

The TrueForge and deepagents arms need no setup step here:
- TrueForge attaches an inline agent spec when it creates each session (see run_tfy in
  bench_matrix.py). Its prerequisites live in TrueForge itself: a model provider for
  MODEL_TFY, and the MCP servers registered as Connectors under the names in MCP_CONFIG.
- deepagents attaches the MCP tools at run time.

    python setup.py

Config: MCP_CONFIG (JSON file {name: url}), SYSTEM_PROMPT, ANTHROPIC_API_KEY, MODEL_CMA,
and optional MCP_BEARER. See .env.example.
"""
import os, json, pathlib

BENCH = pathlib.Path(__file__).parent
OUT = pathlib.Path(os.environ.get("OUT_DIR", str(BENCH / "results")))
SYSTEM = pathlib.Path(os.environ.get("SYSTEM_PROMPT", str(BENCH / "prompts" / "system.md"))).read_text()
MCP = json.loads(pathlib.Path(os.environ["MCP_CONFIG"]).read_text())     # {name: url}
MODEL_CMA = os.environ.get("MODEL_CMA", "claude-opus-4-8")


def setup_cma():
    ids_path = OUT / "cma_ids.json"
    if ids_path.exists():
        print("[cma] cma_ids.json exists, skipping", flush=True); return
    import anthropic
    c = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    env = c.beta.environments.create(name="ebench-env",
        config={"type": "cloud", "networking": {"type": "unrestricted"}})
    mcp_servers = [{"type": "url", "name": n, "url": u} for n, u in MCP.items()]
    tools = [{"type": "mcp_toolset", "mcp_server_name": n,
              "default_config": {"permission_policy": {"type": "always_allow"}}} for n in MCP]
    agent = c.beta.agents.create(name="ebench-cma", model=MODEL_CMA,
        system=SYSTEM, mcp_servers=mcp_servers, tools=tools)
    # If the MCP servers sit behind auth, attach a bearer vault. Otherwise leave it null.
    vault_id = None
    bearer = os.environ.get("MCP_BEARER")
    if bearer:
        try:
            vault = c.beta.vaults.create(display_name="ebench-mcp-bearer")
            for u in MCP.values():
                c.beta.vaults.credentials.create(vault_id=vault.id,
                    auth={"type": "static_bearer", "mcp_server_url": u, "token": bearer})
            vault_id = vault.id
            print(f"[cma] vault {vault_id} with {len(MCP)} bearer creds", flush=True)
        except Exception as e:
            print(f"[cma] WARN vault creation failed ({type(e).__name__}: {e}); "
                  f"MCP auth may fail — check the first trial", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    ids_path.write_text(json.dumps({"env_id": env.id, "agent_id": agent.id, "vault_id": vault_id}, indent=2))
    print(f"[cma] agent {agent.id} / env {env.id} ready", flush=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    harnesses = os.environ.get("HARNESSES", "tfy,cma,deepagents")
    if "cma" in harnesses:
        setup_cma()
    if "tfy" in harnesses:
        print("[tfy] no setup step here, but TrueForge itself needs THREE things "
              "configured (see README): (1) a model provider for MODEL_TFY, (2) the "
              "MCP_CONFIG servers registered as Connectors under the same names, and "
              "(3) a SANDBOX PROVIDER (e.g. Daytona) — required so oversized tool results "
              "offload to a file instead of aborting the heaviest tasks. The agent spec "
              "(sub-agents, compaction, sandbox on, 500 iterations) is sent inline when "
              "each session is created.", flush=True)
    print("[setup] done", flush=True)
