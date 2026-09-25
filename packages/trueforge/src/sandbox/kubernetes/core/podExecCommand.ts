/**
 * `pods/exec` runs a bare argv in the container's existing environment — no `cwd`/`env` fields
 * like TFY's JSON protocol. Per-call cwd/env are composed into a shell script instead.
 */
import { shellEscape } from '@truefoundry/trueforge-core/core';

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Builds the `sh -c <script>` argv for one exec call: env exports, then cd, then the command. */
export function buildPodExecArgv(params: {
  command: string;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
}): readonly string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(params.env ?? {})) {
    if (!ENV_NAME_RE.test(name)) {
      throw new Error(`Invalid environment variable name: ${name}`);
    }
    lines.push(`export ${name}=${shellEscape(value)}`);
  }
  if (params.cwd !== undefined && params.cwd !== '') {
    lines.push(`cd ${shellEscape(params.cwd)}`);
  }
  lines.push(params.command);
  return ['sh', '-c', lines.join('\n')];
}
