#!/bin/bash
set -euo pipefail
pnpm install
pnpm build
pnpm test
