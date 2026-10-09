# db-analyst

Ask questions about your Supabase database in plain English. It reads the
schema, writes and runs the SQL, and when a question calls for a chart it does
the analysis in a sandbox and draws one. It stays read-only unless you ask it to
change something.

## What you'll need

- Connector: `supabase`
- Auth: connect your own Supabase project. The free tier is enough, no paid plan required. Connecting happens through an in-chat authorization flow. On a local instance you may need `PUBLIC_BASE_URL` set so the redirect completes; see the connectors docs.
- Sandbox: yes. The analysis and charts run there.

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `supabase` and connect your project.
3. In Settings, Skills, add `supabase` and `jupyter-notebook`, then in Settings, Sandbox providers, connect a sandbox.
4. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Which five customers have the highest lifetime spend, and how does that compare to the median?

> Plot signups per week for the last quarter and tell me if the trend is up or down.

## How it works

It inspects the schema first, so it queries real columns rather than guessing.
Simple lookups come straight back as SQL results. For anything that needs
aggregation or a visual, it uses the `jupyter-notebook` skill to load the results
and compute them in the sandbox, which keeps the arithmetic honest and lets it
draw a chart. Every answer shows the SQL behind it. Writes are held for your
approval, so exploration is safe by default.

## Make it your own

- Point it at a read replica and hand it to non-engineers as a self-serve reporting tool.
- Add a nightly run that charts your key metrics and posts the summary somewhere.
- Combine it with the decision-brief pattern to turn a data pull into a recommendation.
