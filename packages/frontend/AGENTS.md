## Visual consistency loop

Only when the user supplies a screenshot or explicit UI feedback that needs visual validation: screenshot with `pnpm ui:shot -- <url> current.png`, compare against the reference, iterate until consistent, then `pnpm ui:clean` (no PNGs left in `ui-shots/`).
