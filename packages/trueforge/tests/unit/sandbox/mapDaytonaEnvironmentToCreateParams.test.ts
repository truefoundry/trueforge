import { mapDaytonaEnvironmentToCreateParams } from '../../../src/sandbox/daytonaEnvironment';
import type { DaytonaSandboxEnvironmentManifest } from '../../../src/schemas/sandboxEnvironment';

function manifest(
  overrides: Partial<DaytonaSandboxEnvironmentManifest> & Pick<DaytonaSandboxEnvironmentManifest, 'image'>,
): DaytonaSandboxEnvironmentManifest {
  return {
    type: 'daytona',
    provider: 'daytona',
    ...overrides,
  };
}

describe('mapDaytonaEnvironmentToCreateParams', () => {
  it('maps trueforge-default to the tenant buildRef snapshot', () => {
    expect(
      mapDaytonaEnvironmentToCreateParams({
        manifest: manifest({ image: { type: 'trueforge-default' } }),
        buildRef: 'trueforge-build-abc',
      }),
    ).toEqual({ snapshot: 'trueforge-build-abc' });
  });

  it('maps snapshot and docker image kinds with shared overrides', () => {
    expect(
      mapDaytonaEnvironmentToCreateParams({
        manifest: manifest({
          image: { type: 'snapshot', name: 'my-snap' },
          secrets: { API_KEY: 'org-secret' },
          networking: { network_block_all: true },
          lifecycle: { auto_stop_interval_in_minutes: 30 },
        }),
        buildRef: 'unused',
      }),
    ).toEqual({
      snapshot: 'my-snap',
      secrets: { API_KEY: 'org-secret' },
      networkBlockAll: true,
      autoStopInterval: 30,
    });

    expect(
      mapDaytonaEnvironmentToCreateParams({
        manifest: manifest({
          image: { type: 'docker', ref: 'ghcr.io/acme/box:1' },
          resources: { cpu: 2, memory: 4, gpu: 1, gpu_type: 'H100' },
        }),
        buildRef: 'unused',
      }),
    ).toEqual({
      image: 'ghcr.io/acme/box:1',
      resources: { cpu: 2, memory: 4, gpu: 1, gpuType: 'H100' },
    });
  });
});
