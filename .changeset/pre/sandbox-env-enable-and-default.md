---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Let admins turn sandbox environments off and choose which one is the default.

- Sandbox environments carry `enabled` and `is_default`, changed through `PATCH /api/v1/sandbox-environments/{name}` with those fields. PUT still only updates the definition and creates a version.
- A disabled environment stays listed and keeps working for chats and agents that already name it, but cannot be newly selected. It also cannot be made the default.
- Saving an agent is the exception: create and update return 422 while the named environment is disabled, even if the agent already named it, so an edit cannot leave an agent pointing at an environment nobody may select. Running an agent that already names one is unaffected.
- Setting `is_default` reads the target's `enabled` flag under the same lock that guards the write, so a disable committed just beforehand can no longer hand the default slot to a disabled environment and drop the previous default.
- A draft keeps an environment that is still building or whose last build failed, instead of being moved to the tenant default. Only an environment that has left the catalog or been disabled is replaced, since those are the ones no chat may run on.
- Choosing the default is admin-only, since every chat or agent that names no environment follows it. Enabling and disabling a single environment stays open to its creator.
- Disabling the default releases the default slot, leaving the tenant without one until another is chosen. Bootstrap only claims the slot when it first creates the environment, so a cleared default is not restored on restart.
- New chats and agents start with the environment flagged as default already selected by name, so a later change of default does not move work that was already started. With no default, they start with no environment.
- API callers that omit the environment still resolve the flagged default at request time, rather than the environment named `trueforge-sandbox-env`.
- The default environment cannot be deleted; delete returns 409 on the flagged row.
- The reserved platform-provisioned environment (named `trueforge-sandbox-env`) can only be turned on or off: delete returns 409 on it and create/update reject the reserved name.
- The environment pickers list every environment. Ones that cannot be picked - disabled, still building, or failed - are greyed out and say why on hover. A remembered environment that has left the catalog is repointed at the default.
- `capabilities.sandbox.enabled` now reflects any enabled, ready environment instead of only the one named `trueforge-sandbox-env`.
- Enabling, disabling, or changing the default no longer moves an environment's `updated_at`, which tracks edits to its definition.
- Hovering the `Default` badge on the Envs page explains that agents without an environment run in that one.
- The row actions menu on the Envs page always lists Edit, Set as default, Enable/Disable, and Delete. Ones that do not apply to that row are greyed out and say why on hover, instead of disappearing.
- With no selectable environment, the new-chat and agent-builder pickers say none exist instead of offering a `Default` entry that resolves to nothing.
