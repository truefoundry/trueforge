import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const policyCheck = String.raw`
import runpy
import sys
import types

pydantic = types.ModuleType("pydantic")

class BaseModel:
    pass

class ValidationError(Exception):
    pass

pydantic.BaseModel = BaseModel
pydantic.ValidationError = ValidationError

mcp = types.ModuleType("mcp")
mcp_types = types.ModuleType("mcp.types")

class StubTool:
    def __init__(self, annotations=None):
        self.annotations = annotations

mcp_types.CallToolResult = object
mcp_types.TextContent = object
mcp_types.Tool = StubTool
mcp.types = mcp_types

sys.modules["pydantic"] = pydantic
sys.modules["mcp"] = mcp
sys.modules["mcp.types"] = mcp_types

module = runpy.run_path(sys.argv[1], run_name="mcp_client_policy_test")
is_destructive = module["_is_destructive"]

cases = [
    ("missing annotations", None, True),
    ("empty annotations", types.SimpleNamespace(), True),
    ("camel read-only", types.SimpleNamespace(readOnlyHint=True), False),
    ("snake read-only", types.SimpleNamespace(read_only_hint=True), False),
    (
        "camel additive write",
        types.SimpleNamespace(readOnlyHint=False, destructiveHint=False),
        False,
    ),
    (
        "snake additive write",
        types.SimpleNamespace(read_only_hint=False, destructive_hint=False),
        False,
    ),
    ("camel unspecified write", types.SimpleNamespace(readOnlyHint=False), True),
    ("snake unspecified write", types.SimpleNamespace(read_only_hint=False), True),
    ("explicit destructive", types.SimpleNamespace(destructiveHint=True), True),
]

for label, annotations, expected in cases:
    actual = is_destructive(StubTool(annotations))
    if actual is not expected:
        raise AssertionError(f"{label}: expected {expected}, got {actual}")
`;

describe('Code Mode MCP destructive-tool policy', () => {
  it('fails closed and accepts MCP Python SDK hint casing', () => {
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = resolve(__dirname, '../../../../src/core/sandbox/scripts/mcp_client.py');
    const result = spawnSync(python, ['-c', policyCheck, scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TFY_MCP_SERVERS: '',
        TFY_NATS_SUBJECT_PREFIX: '',
        TFY_NATS_URL: '',
      },
    });

    expect({
      error: result.error?.message,
      status: result.status,
      stderr: result.stderr,
    }).toEqual({
      error: undefined,
      status: 0,
      stderr: '',
    });
  });
});
