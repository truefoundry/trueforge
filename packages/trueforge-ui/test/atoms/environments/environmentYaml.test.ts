import { describe, expect, it } from 'vitest';

import { manifestToYaml, parseManifestYaml } from '@/atoms/environments/environmentYaml.js';

describe('environmentYaml', () => {
  it('round-trips a manifest', () => {
    const yaml = manifestToYaml({
      name: 'yaml-env',
      description: 'from yaml',
      resources: { cpu: 2, memory: 2, disk: 5 },
    });
    const parsed = parseManifestYaml(yaml);
    expect(parsed).toEqual({
      manifest: {
        name: 'yaml-env',
        description: 'from yaml',
        resources: { cpu: 2, memory: 2, disk: 5 },
      },
    });
  });

  it('rejects reserved default name and invalid YAML', () => {
    expect(parseManifestYaml('name: default\n')).toEqual({ error: 'Name "default" is reserved' });
    expect(parseManifestYaml('name: ')).toMatchObject({ error: expect.any(String) });
    expect(parseManifestYaml('- just a list')).toEqual({ error: 'YAML must be an object manifest' });
  });
});
