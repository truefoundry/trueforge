# knowledge-capture

Give it unstructured input such as meeting notes, research, or a set of links,
and it files a clean, findable page in Notion: a title, a summary, the key
points, and the sources, placed in the right part of your workspace. You approve
the page before it is written.

## What you'll need

- Connector: `notion`
- Auth: connect your own Notion workspace. A free personal workspace works. Connecting uses an in-chat authorization flow; on a local instance you may need `PUBLIC_BASE_URL` set so the redirect completes.
- Sandbox: yes (the notion-knowledge-capture skill loads there).

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `notion` and connect your workspace.
3. In Settings, Skills, add `notion-knowledge-capture`, then in Settings, Sandbox providers, connect a sandbox.
4. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Here are my notes from the vendor call. Write them up in Notion under Research.

> Save this thread of links as a page with a summary of what each one covers.

## How it works

It looks at how your workspace is laid out first, so the new page lands somewhere
sensible instead of floating at the top level. It structures the material with a
summary up front and the source links preserved, then shows you the title, the
destination, and the outline before writing anything. If the right home is
unclear, it asks.

## Make it your own

- Chain it after the claim-red-teamer or decision-brief examples to file the verified result.
- Have it append to a running knowledge base instead of creating a new page each time.
- Point it at your own docs system with a custom MCP if you do not use Notion.
