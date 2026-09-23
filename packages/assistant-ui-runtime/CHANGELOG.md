# @truefoundry/trueforge-assistant-ui-runtime

## 0.2.0-rc.0

### Minor Changes

- a855122: Rename the published runtime package to `@truefoundry/trueforge-assistant-ui-runtime`, move it into the TrueForge workspace, rename its public runtime APIs to TrueForge, and remove the legacy TrueFoundry server adapter and server configuration.
- 829ac6e: Add OSS web-search provider settings and catalog (Parallel): singleton settings/catalog APIs, optional API key, and UI adapter without mode config so built-in web search works outside TrueFoundry mode.
- 829ac6e: Add web-search provider settings catalog port and Settings UI so admins can configure Parallel web search (API key + mode) in standalone/OIDC deployments.
