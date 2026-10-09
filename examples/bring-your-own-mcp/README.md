# bring-your-own-mcp

The built-in connectors cover the web, GitHub, and repository docs. To connect
other data or services, you can run your own MCP server and register its URL.
This example includes a small weather MCP server, backed by the keyless
Open-Meteo API, that runs as-is and also serves as a template for your own
service.

## What you'll need

- Node 20 or newer to run the included MCP server
- The `weather` connector, which is the local server in this folder (no key, it uses the free Open-Meteo API)
- Sandbox: not needed

## Run it

From this folder:

```bash
npm install
npm start          # serves the weather MCP at http://localhost:8940/mcp
```

Then, in TrueForge:

1. Settings, Connectors, Add MCP Server. Name it `weather` and give it the URL `http://localhost:8940/mcp`. No auth.
2. Put a model you have configured into `model.name` in `agent.json`.
3. Create the agent (steps in the [examples README](../README.md#running-an-example)) and ask it something.

## Try it

> What's the weather in Lisbon this weekend, and is Saturday or Sunday better for a long walk?

> I'm running an outdoor event in Austin on Friday. Should I have a rain backup?

## Adapt it to your own API

Open `mcp-server.mjs`. Everything below `buildServer()` is transport setup you
can leave unchanged. The only part tied to weather is the `getWeather` function and
the tool definition above it. To wrap your own API:

1. Replace the fetch calls in `getWeather` with calls to your service.
2. Rename the tool and rewrite its description and inputs to match what you expose.
3. Add more tools by calling `server.registerTool(...)` again.

Register the new URL as a connector the same way, point an agent at it, and
you have a custom agent for your domain. If your API needs a key, add it as a
header on the connector in Settings rather than in code, and the agent picks it
up automatically.

## Where to go from here

Once your data is behind a tool, the patterns in the other examples apply directly.
Fan out a sub-agent per record to process many at once (see `security-auditor` or
`claim-red-teamer`), or compute over the results in the sandbox (see
`decision-brief`). The connector is the only part that is specific to you.
