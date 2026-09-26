---
"@truefoundry/trueforge": patch
---

Sync the `opencode-go` model provider's roster from `GET {base_url}/models` on every save, so the settings page and model pickers show the full current OpenCode Go catalog instead of only the shipped presets. Sync is best-effort: failures keep the saved models unchanged.