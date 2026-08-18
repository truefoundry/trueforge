# @truefoundry/trueforge-core

## 0.1.2

### Patch Changes

- 363a522: Wire shared sandbox Code Mode once in SessionHandle from main toolSets before building threads.
- 5b981ab: Cancel a session even when the owning executor is gone (restart) or Redis cannot confirm abort. Freeze the running turn in the store so a new turn can start. `freezeAndGetTurn` now takes the cancellation reason (barge-in stays `cancelled-for-next-turn`; explicit cancel stays `client-cancelled`). Redis timeout and transport failures still freeze, with a warning that the cancel is not clean.

## 0.1.1

### Patch Changes

- 69237db: Await Daytona snapshot registration on sandbox provider configure so auth failures return 422 instead of a false pending status, and keep GET status refreshes persisted.
- 7783fc0: Instruct ask_user_question to mark a first option as (Recommended) when context clearly favors one.

## 0.1.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.

## 0.1.0-rc.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.
