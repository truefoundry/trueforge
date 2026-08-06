/**
 * Binds the SDK's sandbox-artifact block to the harness download API. The SDK renders
 * the card and owns the parsing; only the fetch is ours.
 */
import {
  SandboxArtifactDownload,
  useErrorToasterOptional,
  type SandboxArtifactDownloadProps,
} from '@truefoundry/trueforge-ui';
import { useCallback } from 'react';
import type { HarnessChatServer } from './harnessServer';

export function createSandboxArtifactDownload(server: HarnessChatServer) {
  return function HarnessSandboxArtifactDownload(props: SandboxArtifactDownloadProps) {
    const errorToaster = useErrorToasterOptional();

    // The SDK voids the returned promise, so an uncaught rejection would fail the download silently.
    const onDownloadArtifact = useCallback(
      async (path: string, fileName: string) => {
        try {
          await server.downloadSandboxArtifact({ path, fileName });
        } catch (error) {
          errorToaster?.showError(error);
        }
      },
      [errorToaster],
    );

    return <SandboxArtifactDownload {...props} onDownloadArtifact={onDownloadArtifact} />;
  };
}
