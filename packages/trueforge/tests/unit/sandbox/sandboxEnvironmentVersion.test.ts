import {
  buildNextVersion,
  defaultSandboxEnvironmentStoredManifest,
} from '../../../src/sandbox/sandboxEnvironmentVersion';
import {
  SandboxEnvironmentManifestSchema,
  SandboxEnvironmentSchema,
  UpdateSandboxEnvironmentRequestSchema,
} from '../../../src/schemas/sandboxEnvironment';

describe('buildNextVersion', () => {
  const previous = defaultSandboxEnvironmentStoredManifest('daytona');

  it('allocates a new external_ref when resources change without a build image', () => {
    const next = buildNextVersion({
      version: 2,
      previous_manifest: previous,
      previous_external_ref: 'trueforge-old',
      manifest: {
        name: 'default',
        resources: { cpu: 2, memory: 4, disk: 8 },
      },
      provider_type: 'daytona',
    });

    expect(next.external_ref).not.toBe('trueforge-old');
    expect(next.status).toBe('pending');
    expect(next.manifest.resources).toEqual({ cpu: 2, memory: 4, disk: 8 });
  });

  it('reuses previous_external_ref when only networking changes', () => {
    const next = buildNextVersion({
      version: 2,
      previous_manifest: previous,
      previous_external_ref: 'trueforge-old',
      manifest: {
        name: 'default',
        resources: previous.resources,
        networking: { network_block_all: true },
      },
      provider_type: 'daytona',
    });

    expect(next.external_ref).toBe('trueforge-old');
  });

  it('allocates a new external_ref when build_script changes', () => {
    const withBuild = {
      ...previous,
      image: { type: 'build' as const, build_script: 'pip install httpx' },
    };
    const next = buildNextVersion({
      version: 2,
      previous_manifest: withBuild,
      previous_external_ref: 'trueforge-old',
      manifest: {
        name: 'custom-env',
        resources: withBuild.resources,
        image: { type: 'build', build_script: 'pip install pyjokes' },
      },
      provider_type: 'daytona',
    });

    expect(next.external_ref).not.toBe('trueforge-old');
  });
});

describe('sandbox environment wire schemas', () => {
  const baseEnv = {
    id: 'env-1',
    name: 'default',
    description: '',
    lifecycle_stage: 'active' as const,
    status: 'ready' as const,
    status_reason: null,
    manifest: {
      name: 'default',
      resources: { cpu: 1, memory: 1, disk: 3 },
    },
    created_by_subject: {
      subject_id: 'user-1',
      subject_type: 'user' as const,
      subject_display_name: 'User',
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  it('allows name "default" on SandboxEnvironment responses', () => {
    expect(SandboxEnvironmentSchema.parse(baseEnv).manifest.name).toBe('default');
    expect(SandboxEnvironmentManifestSchema.parse(baseEnv.manifest).name).toBe('default');
  });

  it('rejects name "default" on update requests', () => {
    expect(() =>
      UpdateSandboxEnvironmentRequestSchema.parse({
        manifest: { name: 'default' },
      }),
    ).toThrow(/default/);
  });
});
