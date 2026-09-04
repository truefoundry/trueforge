# incident-investigator

Point it at a Sentry error and it does the first pass of an on-call
investigation: pulls the stack trace, the affected releases, and how often it is
happening, forms a root-cause hypothesis, and writes a short incident summary
you can drop into a channel.

## What you'll need

- Connector: `sentry`
- Auth: connect your own Sentry organization. The developer tier is enough. Connecting uses an in-chat authorization flow; on a local instance you may need `PUBLIC_BASE_URL` set so the redirect completes.
- Sandbox: yes (the sentry skill loads there).

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `sentry` and connect your org.
3. In Settings, Skills, add `sentry`, then in Settings, Sandbox providers, connect a sandbox.
4. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Look at the top unresolved error in my project and tell me what's going on.

> We started seeing TypeErrors after this morning's deploy. Investigate and summarize.

## How it works

It reads the stack trace to form a specific hypothesis rather than restating the
error message, then checks the timing against recent releases to see whether a
deploy is the likely trigger. It separates a sudden spike from a long-running
low-level error, since those need different responses. The summary tells you
what is breaking, who is affected, when it started, the likely cause with its
evidence, and a next step. When it is inferring, it says so.

## Make it your own

- Trigger it automatically when a new issue crosses a frequency threshold.
- Have it open a tracked issue with the summary (see the issue-triage example).
- Add a sub-agent that checks whether the same error was seen and resolved before.
