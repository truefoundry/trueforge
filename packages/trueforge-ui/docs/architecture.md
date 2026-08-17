# Architecture

This package splits UI into **atoms** (presentation) and **containers** (runtime wiring), with a **curated slot registry** for overrides.

## Atoms (`src/atoms/**`)

Presentational components. An atom:

- Does **not** import `@assistant-ui/*` or TrueFoundry runtime hooks.
- Receives data and callbacks as props.
- Owns Tailwind classes / markup for what it renders.
- Curated defaults live in `defaultSlots`; its keys define the public
  `SlotOverrides` contract.
- Per-atom `AtomSlots` augmentations verify internally that `defaultSlots`
  includes every registered atom.
- Low-level primitives and dedicated chrome APIs remain direct imports.

Defaults are registered in [`src/theme/defaultSlots.ts`](../src/theme/defaultSlots.ts).

## Containers (`src/containers/**`)

Stateful glue. A container:

- Reads assistant-ui / TrueFoundry runtime hooks and primitives.
- Derives plain props and callbacks.
- Resolves public visual atoms with `useSlot("Name")`; low-level primitives,
  providers, and dedicated brand/layout APIs are imported directly.
- Avoids decorative styling beyond layout glue.

## Slots (`SlotsProvider`)

```tsx
function MyWelcome({ heading = 'Welcome' }: WelcomeScreenProps) {
  return <h1>{heading}</h1>;
}

<SlotsProvider overrides={{ WelcomeScreen: MyWelcome }}>
  <Thread />
</SlotsProvider>;
```

Nested providers fall through to parent overrides, then `defaultSlots`.
Quick start: `TrueForgeUI` mounts `SlotsProvider` outside the chat
provider. See [customization.md](./customization.md) for the keep-list.

## Theming

Default atoms use CSS variables from the auto-injected stylesheet (scoped to
`.aui-theme-root`). Override colours via `theme.tokens` or host CSS on
`.aui-theme-root` / `.aui-theme-root.dark`.

## Notifications

`ToasterProvider` shows success and error toasts. Descriptions from gateway
errors are truncated for display.
