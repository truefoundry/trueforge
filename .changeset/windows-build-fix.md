---
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Fix build cleanup script to be cross-platform, allowing builds on Windows machines by replacing Unix-specific `rm -rf` with Node's native `fs.rmSync`. Also fix POSIX path operations in Sandbox remote layouts to prevent backslash-delimited paths when tests run on a Windows host.
