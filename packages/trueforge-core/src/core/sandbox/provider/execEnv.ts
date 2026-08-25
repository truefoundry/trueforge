import { join } from 'node:path/posix';

const GIT_STORE_FILE_PREFIX = 'store --file ';

function resolveMaybeRelative(params: { root: string; path: string }): string {
  return params.path.startsWith('/') ? params.path : join(params.root, params.path);
}

/** Make cwd-relative PATH / PYTHONPATH / GIT_CONFIG store --file / TFY_SKILLS_DIR usable from any cwd. */
export function absolutizeRelativeExecEnv(params: {
  root: string;
  env: Record<string, string>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.env)) {
    if (key === 'PATH' || key === 'PYTHONPATH') {
      out[key] = value
        .split(':')
        .map(part => (part.length === 0 ? part : resolveMaybeRelative({ root: params.root, path: part })))
        .join(':');
      continue;
    }
    if (key === 'TFY_SKILLS_DIR' || key === 'VIRTUAL_ENV') {
      out[key] = resolveMaybeRelative({ root: params.root, path: value });
      continue;
    }
    if (key.startsWith('GIT_CONFIG_VALUE_') && value.startsWith(GIT_STORE_FILE_PREFIX)) {
      const file = value.slice(GIT_STORE_FILE_PREFIX.length);
      out[key] = `${GIT_STORE_FILE_PREFIX}${resolveMaybeRelative({ root: params.root, path: file })}`;
      continue;
    }
    out[key] = value;
  }
  return out;
}
