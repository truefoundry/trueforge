/**
 * The SDK augments AtomSlots via an internal `../theme/SlotsProvider.js` path
 * that does not merge for package consumers. Re-declare the slots we override.
 */
import type { WelcomeScreen } from '@truefoundry/trueforge-ui';
import type { OidcLogoutButton } from './components/OidcLogoutButton';

declare module '@truefoundry/trueforge-ui' {
  interface AtomSlots {
    WelcomeScreen: typeof WelcomeScreen;
    LogoutButton: typeof OidcLogoutButton;
  }
}

export {};
