# claim-red-teamer

Paste a claim, or a whole answer another model gave you, and it breaks the text
into individual factual claims, sends a skeptical checker after each one to find
primary sources, and hands back a scorecard that puts the unsupported and
contradicted claims first. It is useful for checking an AI-generated answer before you rely on it.

## What you'll need

- Connector: `exa` (web search and page fetch)
- Auth: none
- Sandbox: not needed

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `exa` (no key).
3. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Fact-check this: Rust has no garbage collector, was first released in 2010, and is used in the Linux kernel.

> Here's an answer another model gave me. Tell me which parts actually hold up: [paste answer]

## How it works

It pulls the factual assertions out of the text and checks each one on its own,
in parallel. Every checker is told to try to disprove its claim, to prefer
primary sources over aggregators, and to mark a claim supported only when it
actually found a source. Claims with no evidence come back as unsupported rather
than being waved through. The result is a scorecard where each claim has a
verdict and a link, with the contradicted and unsupported ones at the top, so
you can see at a glance what not to rely on.

## Make it your own

- Put it at the end of another agent so answers are verified before they reach a user.
- Give each claim two checkers with different priorities and require them to agree.
- Point the checkers at your own documents through a custom MCP so it verifies against your source of truth, not just the open web.
