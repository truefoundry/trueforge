- Changes to types or schemas MUST keep `packages/harness`, `packages/frontend`, `packages/server`, and `patches` synchronized; they MUST NOT update only one affected layer.
- TypeScript code MUST NOT use assertion escapes such as `as T`, `as unknown as T`, non-null `!`, or `as never` to silence type errors; implementations MUST use sound contracts, guards, or corrected types.
- Every type, schema, helper, and contract MUST have one canonical owner; code MUST NOT introduce duplicate definitions or forwarding shims that hide ownership.
- Runtime types backed by Zod schemas MUST be derived with named `z.infer<typeof Schema>` aliases; code MUST NOT duplicate those schemas as hand-written interfaces or indirect utility-type chains.
- Modules MUST use static `import` and `import type`; they MUST NOT use `require()`, `require.resolve()`, or lint suppressions to bypass import checks.
- A change that makes code unused MUST remove that dead code in the same change; it MUST NOT leave stale exports, files, documentation, duplicates, or “just in case” shims.
- Comments MUST explain intent, trade-offs, or constraints and remain concise; they MUST NOT restate the code or include issue-tracker IDs.

## Visual consistency loop

Only when the user supplies a screenshot or explicit UI feedback that needs visual validation: screenshot with `pnpm ui:shot -- <url> current.png`, compare against the reference, iterate until consistent, then `pnpm ui:clean` (no PNGs left in `ui-shots/`).
