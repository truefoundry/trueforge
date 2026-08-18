#!/usr/bin/env bash
# Patch-changeset @truefoundry/trueforge-core unless a pending file already names it.
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
for file in .changeset/*.md; do
  if [[ "$(basename "$file")" == "README.md" ]]; then
    continue
  fi
  if grep -Eq "^['\"]@truefoundry/trueforge-core['\"]:" "$file"; then
    echo "Pending changeset already names @truefoundry/trueforge-core ($(basename "$file")); skipping."
    exit 0
  fi
done

slug="pin-sandbox-image"
outfile=".changeset/$(date -u +%Y%m%d%H%M%S)-${slug}.md"
cat >"$outfile" <<'EOF'
---
"@truefoundry/trueforge-core": patch
---

Pin SANDBOX_IMAGE_URI to the image pushed by CI.
EOF

echo "Wrote $outfile"
