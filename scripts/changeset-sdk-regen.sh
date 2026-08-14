#!/usr/bin/env bash
# Patch-changeset @truefoundry/trueforge-sdk for a Fern regen, unless a pending
# changeset already names that package (so repeated regens do not pile files).
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
for file in .changeset/*.md; do
  if [[ "$(basename "$file")" == "README.md" ]]; then
    continue
  fi
  if grep -Eq "^['\"]@truefoundry/trueforge-sdk['\"]:" "$file"; then
    echo "Pending changeset already names @truefoundry/trueforge-sdk ($(basename "$file")); skipping."
    exit 0
  fi
done

slug="regenerate-sdk-from-openapi"
outfile=".changeset/$(date -u +%Y%m%d%H%M%S)-${slug}.md"
cat >"$outfile" <<'EOF'
---
"@truefoundry/trueforge-sdk": patch
---

Regenerate SDK from updated OpenAPI spec.
EOF

echo "Wrote $outfile"
