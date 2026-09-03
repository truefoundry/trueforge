import { TrueForgeMode } from '../config';
import type { TrueFoundryServiceFoundryServerClient } from '../truefoundry/TrueFoundryServiceFoundryServerClient';
import type { Authenticator } from './authenticator';
import { OidcAuthenticator } from './oidcAuthenticator';
import { StandaloneAuthenticator } from './standaloneAuthenticator';
import { TrueFoundryAuthenticator } from './trueFoundryAuthenticator';

export { TrueForgeMode };

export type CreateAuthenticatorParams =
  | { mode: TrueForgeMode.Standalone }
  | { mode: TrueForgeMode.Oidc }
  | { mode: TrueForgeMode.TrueFoundry; trueFoundryClient: TrueFoundryServiceFoundryServerClient };

/** Build the single process authenticator from resolved auth mode. */
export function createAuthenticator(params: CreateAuthenticatorParams): Authenticator {
  switch (params.mode) {
    case TrueForgeMode.TrueFoundry:
      return new TrueFoundryAuthenticator(params.trueFoundryClient);
    case TrueForgeMode.Oidc:
      return new OidcAuthenticator();
    case TrueForgeMode.Standalone:
      return new StandaloneAuthenticator();
  }
}
