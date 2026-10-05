---
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Bump `monaco-editor` to `^0.57.0` to address known vulnerabilities, and point the frontend Monaco worker plugin at the 0.56+ export paths so production builds resolve workers correctly.
