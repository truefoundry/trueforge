# @truefoundry/trueforge-ui

- Atoms are presentational; containers wire runtime hooks and resolve atoms via `useSlot`.
- New JSX-bearing atoms MUST augment `AtomSlots`, register in `defaultSlots`, and be consumed via `useSlot` (see `.cursor/rules/trueforge-ui-slots.mdc`).
- AgentUIServer / server-port types MUST be re-exported from `src/server/types.ts` only — no parallel hand-written DTOs.
- UI lengths use `rem` (1rem = 16px); prefer Tailwind scale utilities.

## Analytics

- The analytics sink is host-only. This package MUST NOT depend on PostHog or any other vendor SDK.
- Canonical event names live only in `src/analytics/events.ts` (`AnalyticsEvents`).
- Fire from containers wrapping atom callbacks (or documented atom chrome: settings, config trigger, share). Do not duplicate sinks.
- `useTrackAnalytics()` MUST no-op when no host `track` is provided (never throw).
- New clickable product actions MUST add a catalog entry and a fire site in the same change.
