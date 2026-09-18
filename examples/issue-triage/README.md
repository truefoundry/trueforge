# issue-triage

Hand it a bug report, a feature request, or a batch of notes from a call, and it
turns them into clean Linear issues: a clear title, reproduction steps or
acceptance criteria, a priority, and labels. It checks for duplicates first, and
nothing is created in your tracker without your approval.

## What you'll need

- Connector: `linear`
- Auth: connect your own Linear workspace. The free plan is enough. Connecting uses an in-chat authorization flow; on a local instance you may need `PUBLIC_BASE_URL` set so the redirect completes.
- Sandbox: yes (the linear skill loads there).

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `linear` and connect your workspace.
3. In Settings, Skills, add `linear`, then in Settings, Sandbox providers, connect a sandbox.
4. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Users are reporting the export button does nothing on Safari. File this properly.

> Here are my notes from the planning call. Turn them into issues, and flag anything that already exists: [paste notes]

## How it works

It reads each item, searches Linear for something that already covers it, and
either points you at the existing issue or drafts a new one that follows your
workspace conventions. You review the drafts before anything is written, and for
a batch it shows the whole set, de-duplicated and grouped, so you approve once
rather than issue by issue.

## Make it your own

- Wire it to an intake form or a support inbox so reports arrive pre-triaged.
- Have it add the reporter and a severity based on how many people hit the same thing.
- Point it at your own tracker instead of Linear with a custom MCP.
