#!/usr/bin/env bash
# Always write: this lands on a separate pin PR; pending main files may be consumed first.
set -euo pipefail
cd "$(dirname "$0")/.."

slug="update-sandbox-image"
outfile=".changeset/$(date -u +%Y%m%d%H%M%S)-${slug}.md"
cat >"$outfile" <<'EOF'
---
'@truefoundry/trueforge-core': patch
---

Update SANDBOX_IMAGE_URI to the image pushed by CI.
EOF

echo "Wrote $outfile"
