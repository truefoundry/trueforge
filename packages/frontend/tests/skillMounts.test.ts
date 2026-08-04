import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SkillEntry } from '../src/catalog';
import {
  DEFAULT_SKILL_REF,
  selectedSkillNamesFromSpec,
  skillMountsFromNames,
  toGitSkillMount,
} from '../src/skillMounts';

const entry: SkillEntry = {
  name: 'pr-review',
  url: 'https://github.com/acme/skills',
  path: 'skills/pr-review',
  ref: 'v1.2.0',
  description: 'Reviews pull requests',
};

describe('toGitSkillMount', () => {
  it('maps catalog fields to a git mount', () => {
    assert.deepEqual(toGitSkillMount(entry), {
      type: 'git',
      url: 'https://github.com/acme/skills',
      path: 'skills/pr-review',
      name: 'pr-review',
      description: 'Reviews pull requests',
      ref: 'v1.2.0',
    });
  });

  it('defaults omitted ref to HEAD', () => {
    const mount = toGitSkillMount({
      name: 'echo',
      url: 'https://github.com/acme/skills',
      description: 'Echo',
    });
    assert.equal(mount.ref, DEFAULT_SKILL_REF);
  });
});

describe('skillMountsFromNames', () => {
  it('preserves selection order of names that exist in the catalog', () => {
    const other: SkillEntry = {
      name: 'echo',
      url: 'https://github.com/acme/skills',
      description: 'Echo',
    };
    const mounts = skillMountsFromNames(new Set(['missing', 'echo', 'pr-review']), [entry, other]);
    assert.deepEqual(
      mounts.map(m => m.name),
      ['echo', 'pr-review'],
    );
  });
});

describe('selectedSkillNamesFromSpec', () => {
  it('reads names from persisted git mounts', () => {
    const names = selectedSkillNamesFromSpec([toGitSkillMount(entry)]);
    assert.deepEqual([...names], ['pr-review']);
  });
});
