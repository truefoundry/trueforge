# Contributing

Thanks for contributing to `@truefoundry/trueforge-ui`.

## Development

From the monorepo root:

```bash
pnpm install
pnpm --filter @truefoundry/trueforge-ui typecheck
pnpm --filter @truefoundry/trueforge-ui test
pnpm --filter @truefoundry/trueforge-ui build
pnpm --filter @truefoundry/trueforge-ui lint
```

- Prefer small, focused PRs.
- Match existing patterns in `src/atoms` (presentational) and `src/containers` (runtime wiring).
- Atoms must not import `@assistant-ui/*` or TrueFoundry runtime hooks.
- Containers resolve atoms via `useSlot`, not direct atom imports (types are fine).
- Update `CHANGELOG.md` under **Unreleased** for user-visible changes.

## Pull requests

1. Open a PR against `main`.
2. Ensure CI is green (`typecheck`, `test`, `build`, `lint`).
3. Confirm the Unreleased changelog entry when the change is user-visible.

## Reporting bugs

Include package version, peer versions, and a minimal reproduction when possible.

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).
