import { darwinSandboxNetworkShellPreamble } from '../../../../../src/sandbox/local/core/hostRun';

describe('darwinSandboxNetworkShellPreamble', () => {
  it('rewrites localhost to 127.0.0.1 in SRT proxy env vars', () => {
    const preamble = darwinSandboxNetworkShellPreamble();
    expect(preamble).toMatch(/HTTP_PROXY="\$\{HTTP_PROXY\/\/localhost\/127\.0\.0\.1\}"/);
    expect(preamble).toMatch(/HTTPS_PROXY="\$\{HTTPS_PROXY\/\/localhost\/127\.0\.0\.1\}"/);
    expect(preamble).toMatch(/ALL_PROXY="\$\{ALL_PROXY\/\/localhost\/127\.0\.0\.1\}"/);
  });
});
