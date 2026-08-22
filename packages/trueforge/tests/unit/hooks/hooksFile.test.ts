import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from 'winston';
import { loadHooksFile } from '../../../src/hooks/hooksFile';

const logger = createLogger({ silent: true });

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeTempHooksFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-hooks-test-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'hooks.json');
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('loadHooksFile', () => {
  it('returns undefined for a missing file at the default location (hooks disabled)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-hooks-test-'));
    tempDirs.push(dir);
    expect(loadHooksFile({ path: path.join(dir, 'hooks.json'), explicitPath: false, logger })).toBeUndefined();
  });

  it('throws for a missing file at an explicitly configured path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-hooks-test-'));
    tempDirs.push(dir);
    expect(() => loadHooksFile({ path: path.join(dir, 'hooks.json'), explicitPath: true, logger })).toThrow(
      /TRUEFORGE_HOOKS_PATH/,
    );
  });

  it('loads a valid file with defaults applied', () => {
    const filePath = writeTempHooksFile(
      JSON.stringify({ version: 1, hooks: { pre_tool_use: [{ type: 'command', command: 'echo hi' }] } }),
    );
    const loaded = loadHooksFile({ path: filePath, explicitPath: false, logger });
    expect(loaded?.hooks.pre_tool_use[0]?.command).toBe('echo hi');
    expect(loaded?.hooks.pre_tool_use[0]?.fail_mode).toBe('open');
  });

  it('throws on invalid JSON, naming the file', () => {
    const filePath = writeTempHooksFile('{not json');
    expect(() => loadHooksFile({ path: filePath, explicitPath: false, logger })).toThrow(filePath);
  });

  it('throws on a schema violation, naming the offending path', () => {
    const filePath = writeTempHooksFile(JSON.stringify({ version: 1, hooks: { pre_tool_use: [{ type: 'command' }] } }));
    expect(() => loadHooksFile({ path: filePath, explicitPath: false, logger })).toThrow(/pre_tool_use/);
  });
});
