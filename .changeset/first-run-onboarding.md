---
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge": patch
---

Add a first-run onboarding flow that connects a model (required) and MCP servers (optional) when no model provider exists. It replaces the `initialSettingsOpen` prop with an `onboarding` opt-out on `TrueForgeUI`.
