import { TrueForgeAuthMode } from '../config';
import type { TrueFoundryServiceFoundryServerClient } from '../truefoundry/TrueFoundryServiceFoundryServerClient';
import type { Authenticator } from './authenticator';
import { OidcAuthenticator } from './oidcAuthenticator';
import { StandaloneAuthenticator } from './standaloneAuthenticator';
import { TrueFoundryAuthenticator } from './trueFoundryAuthenticator';

export type CreateAuthenticatorParams =
  | { mode: TrueForgeAuthMode.Standalone }
  | { mode: TrueForgeAuthMode.Oidc }
  | { mode: TrueForgeAuthMode.TrueFoundry; serviceFoundryClient: TrueFoundryServiceFoundryServerClient };

/** Build the single process authenticator from resolved auth mode. */
export function createAuthenticator(params: CreateAuthenticatorParams): Authenticator {
  switch (params.mode) {
    case TrueForgeAuthMode.TrueFoundry:
      return new TrueFoundryAuthenticator(params.serviceFoundryClient);
    case TrueForgeAuthMode.Oidc:
      return new OidcAuthenticator();
    case TrueForgeAuthMode.Standalone:
      return new StandaloneAuthenticator();
  }
}
