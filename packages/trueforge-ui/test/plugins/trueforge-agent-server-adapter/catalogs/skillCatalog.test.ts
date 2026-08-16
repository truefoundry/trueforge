import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  toHarnessManifest,
  toUiCatalogEntry,
  toUiSkill,
} from '@/plugins/trueforge-agent-server-adapter/catalogs/skillCatalog.js';

describe('skillCatalog mappers', () => {
  it('maps catalog presets with id = name and repoURL from url', () => {
    assert.deepEqual(
      toUiCatalogEntry({
        type: 'git',
        name: 'algorithmic-art',
        url: 'https://github.com/anthropics/skills',
        path: 'skills/algorithmic-art',
        ref: 'main',
        description: 'Create algorithmic art',
      }),
      {
        id: 'algorithmic-art',
        name: 'algorithmic-art',
        description: 'Create algorithmic art',
        repoURL: 'https://github.com/anthropics/skills',
        path: 'skills/algorithmic-art',
        ref: 'main',
      },
    );
  });

  it('uses empty path when harness omits path', () => {
    assert.equal(
      toUiCatalogEntry({
        type: 'git',
        name: 'root-skill',
        url: 'https://github.com/example/skills',
        ref: 'main',
        description: 'Root skill',
      }).path,
      '',
    );
  });

  it('omits empty path on harness upsert and maps repoURL to url', () => {
    assert.deepEqual(
      toHarnessManifest({
        name: 'root-skill',
        description: 'Root skill',
        repoURL: 'https://github.com/example/skills',
        path: '  ',
        ref: 'main',
      }),
      {
        type: 'git',
        name: 'root-skill',
        description: 'Root skill',
        url: 'https://github.com/example/skills',
        ref: 'main',
      },
    );
    assert.deepEqual(
      toHarnessManifest({
        name: 'nested',
        description: 'Nested',
        repoURL: 'https://github.com/example/skills',
        path: 'skills/nested',
        ref: 'v1',
      }),
      {
        type: 'git',
        name: 'nested',
        description: 'Nested',
        url: 'https://github.com/example/skills',
        path: 'skills/nested',
        ref: 'v1',
      },
    );
  });

  it('attaches catalogId when configured name matches a catalog preset', () => {
    const catalogNames = new Set(['algorithmic-art']);
    assert.deepEqual(
      toUiSkill(
        {
          name: 'algorithmic-art',
          manifest: {
            type: 'git',
            name: 'algorithmic-art',
            url: 'https://github.com/anthropics/skills',
            path: 'skills/algorithmic-art',
            ref: 'main',
            description: 'Create algorithmic art',
          },
        },
        catalogNames,
      ),
      {
        id: 'algorithmic-art',
        name: 'algorithmic-art',
        description: 'Create algorithmic art',
        catalogId: 'algorithmic-art',
      },
    );
    assert.deepEqual(
      toUiSkill(
        {
          name: 'house-style',
          manifest: {
            type: 'git',
            name: 'house-style',
            url: 'https://github.com/example/skills',
            path: 'skills/house-style',
            ref: 'main',
            description: 'House style',
          },
        },
        catalogNames,
      ),
      {
        id: 'house-style',
        name: 'house-style',
        description: 'House style',
      },
    );
  });
});
