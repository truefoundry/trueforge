# decision-brief

Give it a handful of options to compare and it produces a scored, sourced brief:
one researcher per option, then a weighted scoring matrix worked out in a
sandbox so the numbers are calculated rather than guessed, presented as a table
with a ranked recommendation.

## What you'll need

- Connector: `exa`, or swap to `tavily` for keyed search with a bit more depth
- Auth: none for exa; a free key if you use tavily
- Sandbox: yes. The scoring runs there.

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `exa` (no key).
3. In Settings, Sandbox providers, connect a sandbox.
4. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Compare Postgres, MongoDB, and DynamoDB for a write-heavy analytics workload. Weight cost and operational simplicity highest.

> Fly.io, Render, or Railway for a small team shipping a Node API? You pick the criteria.

## How it works

It proposes a set of criteria and weights (or takes yours), then researches each
option separately so one option's findings do not bleed into another's. The
scoring is done in code: instead of estimating a winner, it writes a
short Python script in the sandbox to build the options-by-criteria matrix, apply
the weights, and compute the totals. You get a comparison table, a ranked pick,
and an honest "switch to this one if" caveat, with the thin or unknown cells
marked rather than filled with guesses.

## Make it your own

- Let people re-weight the criteria and re-run just the scoring, reusing the research.
- Add a risk column sourced with the claim-red-teamer pattern.
- Point the researchers at an internal knowledge base through a custom MCP for build-versus-buy calls.
