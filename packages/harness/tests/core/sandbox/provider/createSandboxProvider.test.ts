/**
 * Library-level sandbox provider registry: settings union parsing and the
 * settings → provider factory (public harness, no gateway config involved).
 */
import {
  createSandboxProvider,
  SandboxProviderSettingsSchema,
} from '../../../../src/core/sandbox/provider/createSandboxProvider';
import { DaytonaSandboxProvider } from '../../../../src/core/sandbox/provider/DaytonaProvider';
import { makeSilentLogger } from '../../harnessMocks';

describe('SandboxProviderSettingsSchema', () => {
  it('parses minimal daytona settings and applies defaults', () => {
    const settings = SandboxProviderSettingsSchema.parse({
      type: 'daytona',
      apiKey: 'key-1',
      snapshotName: 'snap-1',
    });
    expect(settings).toEqual({
      type: 'daytona',
      apiKey: 'key-1',
      snapshotName: 'snap-1',
      timeoutMs: 60_000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 43_200,
    });
  });

  it('keeps explicit overrides', () => {
    const settings = SandboxProviderSettingsSchema.parse({
      type: 'daytona',
      apiKey: 'key-1',
      snapshotName: 'snap-1',
      timeoutMs: 5_000,
      autoStopIntervalInMinutes: 0,
    });
    expect(settings.timeoutMs).toBe(5_000);
    expect(settings.autoStopIntervalInMinutes).toBe(0);
  });

  it('rejects an unknown provider type', () => {
    expect(() => SandboxProviderSettingsSchema.parse({ type: 'e2b', apiKey: 'k', snapshotName: 's' })).toThrow();
  });

  it('rejects missing apiKey / snapshotName', () => {
    expect(() => SandboxProviderSettingsSchema.parse({ type: 'daytona', snapshotName: 's' })).toThrow();
    expect(() => SandboxProviderSettingsSchema.parse({ type: 'daytona', apiKey: 'k' })).toThrow();
    expect(() => SandboxProviderSettingsSchema.parse({ type: 'daytona', apiKey: '', snapshotName: 's' })).toThrow();
  });

  it('rejects unknown keys (strict schema)', () => {
    expect(() =>
      SandboxProviderSettingsSchema.parse({
        type: 'daytona',
        apiKey: 'k',
        snapshotName: 's',
        snapshot_name: 'typo',
      }),
    ).toThrow();
  });
});

describe('createSandboxProvider', () => {
  it('builds a DaytonaSandboxProvider for type "daytona"', () => {
    const provider = createSandboxProvider({
      settings: SandboxProviderSettingsSchema.parse({
        type: 'daytona',
        apiKey: 'key-1',
        snapshotName: 'snap-1',
      }),
      tenantName: 'tenant-1',
      fileMaxBytes: 1024,
      previewUrlExpirySeconds: 60,
      logger: makeSilentLogger(),
    });
    expect(provider).toBeInstanceOf(DaytonaSandboxProvider);
  });
});
