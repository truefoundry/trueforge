# @truefoundry/trueforge-ui

- Atoms are presentational; containers wire runtime hooks and resolve atoms via `useSlot`.
- New JSX-bearing atoms MUST augment `AtomSlots`, register in `defaultSlots`, and be consumed via `useSlot` (see `.cursor/rules/trueforge-ui-slots.mdc`).
- AgentUIServer / server-port types MUST be re-exported from `src/server/types.ts` only — no parallel hand-written DTOs.
- Recurring UI patterns (chip inputs, selects, menus, rows) MUST be extracted into small primitives under `src/atoms/primitives/` instead of re-implemented inline in each component.
- Primitives MUST be generic and reusable: they take data, labels, and callbacks as props (generic `<T>` plus `getKey`/`getLabel` where it fits) and MUST NOT hold feature-specific state, copy, or domain types (e.g. share-dialog users or previously selected options). Feature state stays in the consuming component.
- Primitives MUST render their own popovers, lists, and empty states and expose slot props (e.g. `renderOption`, `menuFooter`, `noDataPlaceholder`); consumers MUST NOT re-render those parts beside the primitive.
- Before adding inline markup, check `src/atoms/primitives/` and the `src/atoms/lib/` class helpers; extend an existing primitive rather than forking it.
- UI lengths use `rem` (1rem = 16px); prefer Tailwind scale utilities.

## Analytics

- The analytics sink is host-only. This package MUST NOT depend on PostHog or any other vendor SDK.
- Canonical event names live only in `src/analytics/events.ts` (`AnalyticsEvents`).
- Fire from containers wrapping atom callbacks (or documented atom chrome: settings, config trigger, share). Do not duplicate sinks.
- `useTrackAnalytics()` MUST no-op when no host `track` is provided (never throw).
- New clickable product actions MUST add a catalog entry and a fire site in the same change.
