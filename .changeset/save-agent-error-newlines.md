---
'@truefoundry/trueforge-ui': patch
---

Decode common escape sequences (`\n`, `\t`, `\r`, `\uXXXX`, …) in user-facing API error messages and render them with `whitespace-pre-wrap` so multi-line Zod validation output displays correctly.
