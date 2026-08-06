/**
 * The SDK augments AtomSlots via an internal `../theme/SlotsProvider.js` path
 * that does not merge for package consumers. Re-declare the slots we override.
 */
import type { SandboxArtifactDownload, WelcomeScreen } from '@truefoundry/trueforge-ui';

declare module '@truefoundry/trueforge-ui' {
  interface AtomSlots {
    WelcomeScreen: typeof WelcomeScreen;
    SandboxArtifactDownload: typeof SandboxArtifactDownload;
  }
}

export {};
