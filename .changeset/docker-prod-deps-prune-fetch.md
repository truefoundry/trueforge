---
'@truefoundry/trueforge': patch
---

Stop `pnpm fetch` from leaving a full `node_modules/.pnpm` in the image store stage so the production install no longer copies build tooling (esbuild, TypeScript, etc.) into the runtime image.
