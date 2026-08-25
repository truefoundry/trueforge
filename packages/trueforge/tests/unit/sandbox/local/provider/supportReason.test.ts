import { srtHostBinaryNames } from '../../../../../src/sandbox/local/core/hostRun';
import { formatLocalSandboxSupportReason } from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

describe('SRT host binaries', () => {
  it('requires bwrap, socat, and rg on Linux', () => {
    expect(srtHostBinaryNames('linux')).toEqual(['bwrap', 'socat', 'rg']);
  });

  it('requires no extra host binaries on macOS (seatbelt, no rg scan)', () => {
    expect(srtHostBinaryNames('darwin')).toEqual([]);
  });
});

describe('formatLocalSandboxSupportReason', () => {
  it('reports missing host SRT binaries on PATH', () => {
    expect(
      formatLocalSandboxSupportReason({
        summary: 'SRT host dependencies missing (linux: bwrap, socat, rg)',
        attempts: [
          { kind: 'host', name: 'bwrap', resolved: undefined },
          { kind: 'host', name: 'socat', resolved: '/usr/bin/socat' },
          { kind: 'host', name: 'rg', resolved: undefined },
        ],
      }),
    ).toBe(
      'SRT host dependencies missing (linux: bwrap, socat, rg): bwrap: not on PATH; socat: resolved=/usr/bin/socat; rg: not on PATH',
    );
  });

  it('includes the UDS listen error', () => {
    expect(
      formatLocalSandboxSupportReason({
        summary: 'Code Mode UDS listen failed',
        attempts: [
          {
            kind: 'socket',
            name: 'uds',
            resolved: '/private/tmp/tf_cms',
            protocolError: 'listen /private/tmp/tf_cms/01h (90 bytes): listen EADDRINUSE',
          },
        ],
      }),
    ).toBe(
      'Code Mode UDS listen failed: uds: resolved=/private/tmp/tf_cms protocolError=listen /private/tmp/tf_cms/01h (90 bytes): listen EADDRINUSE',
    );
  });
});
