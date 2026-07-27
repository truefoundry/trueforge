- Durable state MUST follow:
  ```ts
  yield event; // consumer persists and may throw
  mutateMemory(); // runs only after persistence succeeds
  ```
