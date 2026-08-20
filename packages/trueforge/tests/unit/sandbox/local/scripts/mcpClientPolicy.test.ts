import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const policyCheck = String.raw`
import runpy
import sys

module = runpy.run_path(sys.argv[1], run_name="mcp_client_local_policy_test")
is_destructive = module["_is_destructive"]

cases = [
    ("missing annotations", {}, True),
    ("null annotations", {"annotations": None}, True),
    ("malformed annotations", {"annotations": []}, True),
    ("empty annotations", {"annotations": {}}, True),
    ("camel read-only", {"annotations": {"readOnlyHint": True}}, False),
    ("snake read-only", {"annotations": {"read_only_hint": True}}, False),
    (
        "camel additive write",
        {"annotations": {"readOnlyHint": False, "destructiveHint": False}},
        False,
    ),
    (
        "snake additive write",
        {"annotations": {"read_only_hint": False, "destructive_hint": False}},
        False,
    ),
    ("camel unspecified write", {"annotations": {"readOnlyHint": False}}, True),
    ("snake unspecified write", {"annotations": {"read_only_hint": False}}, True),
    ("explicit destructive", {"annotations": {"destructiveHint": True}}, True),
]

for label, tool, expected in cases:
    actual = is_destructive(tool)
    if actual is not expected:
        raise AssertionError(f"{label}: expected {expected}, got {actual}")
`;

describe('local Code Mode MCP destructive-tool policy', () => {
  it('fails closed and accepts both hint casings', () => {
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = resolve(__dirname, '../../../../../src/sandbox/local/scripts/mcp_client_local.py');
    const result = spawnSync(python, ['-c', policyCheck, scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TFY_MCP_SERVERS: '',
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
