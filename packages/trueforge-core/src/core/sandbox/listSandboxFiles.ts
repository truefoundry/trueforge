import { ensureExecSuccess, shellEscape, type ExecResult, type SandboxExecParams } from './provider/Provider';

export interface ListedSandboxFile {
  /** Path relative to `root`, using `/` separators. */
  path: string;
  sizeBytes: number;
}

export interface ListSandboxFilesResult {
  files: ListedSandboxFile[];
  /** True when the directory held more files than `maxFiles`. */
  truncated: boolean;
}

/**
 * Lists regular files under a sandbox directory. Uses POSIX `find` and `wc` so it
 * works on the macOS host sandbox (BSD find has no `-printf`) and on remote sandboxes.
 * Symlinks are not followed: `-type f` matches only regular files.
 */
export async function listSandboxFiles(input: {
  exec: (params: SandboxExecParams) => Promise<ExecResult>;
  sandboxId: string;
  root: string;
  maxFiles: number;
}): Promise<ListSandboxFilesResult> {
  if (input.root.includes('\0')) {
    throw new Error('Sandbox directory must not contain a NUL byte');
  }
  const command = [
    'find',
    shellEscape(input.root),
    '\\(',
    '-name',
    '.git',
    '-o',
    '-name',
    'node_modules',
    '-o',
    '-name',
    '.venv',
    '-o',
    '-name',
    '__pycache__',
    '\\)',
    '-prune',
    '-o',
    '-type',
    'f',
    '-exec',
    'wc',
    '-c',
    '{}',
    '+',
  ].join(' ');
  const result = await input.exec({ sandboxId: input.sandboxId, command, timeoutSeconds: 30 });
  ensureExecSuccess(result);
  return parseFindWcOutput({ output: result.response.result, root: input.root, maxFiles: input.maxFiles });
}

/** Parses `wc -c` lines (`<size> <absolute path>`), skipping the `total` line. */
export function parseFindWcOutput(input: { output: string; root: string; maxFiles: number }): ListSandboxFilesResult {
  const root = input.root.endsWith('/') ? input.root.slice(0, -1) : input.root;
  const files: ListedSandboxFile[] = [];
  let truncated = false;
  for (const line of input.output.split('\n')) {
    const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
    if (match === null) {
      continue;
    }
    const sizeText = match[1];
    const absolute = match[2];
    if (sizeText === undefined || absolute === undefined || absolute === 'total') {
      continue;
    }
    if (absolute !== root && !absolute.startsWith(`${root}/`)) {
      continue;
    }
    const relative = absolute === root ? '' : absolute.slice(root.length + 1);
    if (relative === '' || relative.split('/').some(segment => segment === '..' || segment === '')) {
      continue;
    }
    if (files.length >= input.maxFiles) {
      truncated = true;
      break;
    }
    const sizeBytes = Number(sizeText);
    if (!Number.isSafeInteger(sizeBytes)) {
      continue;
    }
    files.push({ path: relative, sizeBytes });
  }
  return { files, truncated };
}
