// A minimal MCP server you can copy and point at your own API.
//
// TrueForge connects to MCP servers over HTTP, so this listens on a port and
// speaks the MCP streamable-HTTP transport at POST /mcp. It exposes one tool,
// get_weather, backed by Open-Meteo, which needs no API key.
//
// To wrap your own service: keep the transport wiring below as-is, and replace
// the fetch calls in getWeather (and the tool's name, description, and inputs)
// with your API. That is the only change needed. Everything from buildServer()
// down is reusable unchanged.

import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.WEATHER_MCP_PORT || 8940);

// --- Your API. This is the part you swap out. -------------------------------

async function getWeather({ location }) {
  // Step 1: turn a place name into coordinates.
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
    { signal: AbortSignal.timeout(10000) }
  ).then((r) => r.json());

  const place = geo?.results?.[0];
  if (!place) {
    return { error: `Couldn't find a place called "${location}".` };
  }

  // Step 2: fetch the current conditions and a short daily outlook.
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,apparent_temperature,precipitation,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "3",
  });
  const wx = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.json());

  return {
    location: `${place.name}, ${place.country ?? ""}`.trim().replace(/,$/, ""),
    current: wx.current ?? null,
    units: { ...(wx.current_units ?? {}), ...(wx.daily_units ?? {}) },
    next_3_days: (wx.daily?.time ?? []).map((date, i) => ({
      date,
      high: wx.daily.temperature_2m_max?.[i],
      low: wx.daily.temperature_2m_min?.[i],
      precip_chance: wx.daily.precipitation_probability_max?.[i],
    })),
  };
}

// --- MCP wiring. Reusable as-is for any single-tool server. -----------------

function buildServer() {
  const server = new McpServer(
    { name: "weather", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "get_weather",
    {
      title: "Get the weather for a place",
      description:
        "Current conditions and a three-day outlook for a place, by name. " +
        "Backed by the public Open-Meteo API. No API key required.",
      inputSchema: {
        location: z.string().min(1).describe("A city or place name, e.g. 'Lisbon' or 'Austin, Texas'."),
      },
    },
    async (args) => {
      const out = await getWeather(args);
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send("Weather MCP. POST MCP requests to /mcp. Tool: get_weather.");
});

app.post("/mcp", async (req, res) => {
  // Stateless: a fresh server and transport per request, so there are no
  // sessions to track. Fine for tools that are plain request/response.
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[weather-mcp] request failed:", err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[weather-mcp] listening on http://localhost:${PORT}/mcp`);
});
