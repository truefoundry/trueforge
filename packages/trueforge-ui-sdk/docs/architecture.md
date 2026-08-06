# Architecture

This package splits UI into **atoms** (presentation) and **containers** (runtime wiring), with a **curated slot registry** for overrides.

## Atoms (`src/atoms/**`)

Presentational components. An atom:

- Does **not** import `@assistant-ui/*` or TrueFoundry runtime hooks.
- Receives data and callbacks as props.
- Owns Tailwind classes / markup for what it renders.
- Curated atoms register on `AtomSlots` via `declare module` augmentation;
  chrome / primitives are direct imports (not slots).

Defaults are registered in [`src/theme/defaultSlots.ts`](../src/theme/defaultSlots.ts).

## Containers (`src/containers/**`)

Stateful glue. A container:

- Reads assistant-ui / TrueFoundry runtime hooks and primitives.
- Derives plain props and callbacks.
- Resolves curated atoms with `useSlot("Name")`; other atoms are imported
  directly.
- Avoids decorative styling beyond layout glue.

## Slots (`SlotsProvider`)

```tsx
<SlotsProvider overrides={{ WelcomeScreen: MyWelcome }}>
  <Thread />
</SlotsProvider>
```

Nested providers fall through to parent overrides, then `defaultSlots`.
Quick start: `TrueforgeUI` mounts `SlotsProvider` outside the chat
provider. See [customization.md](./customization.md) for the keep-list.

## Theming

Default atoms use CSS variables from `styles.css`. Override colours in host
`:root` / `.dark` after importing the SDK stylesheet, or via `theme.tokens`.

## Errors

`ErrorToasterProvider` shows a single toast (no queue). Descriptions from
gateway errors are truncated for display.
