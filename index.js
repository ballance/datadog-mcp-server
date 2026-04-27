import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DD_API_KEY = process.env.DD_API_KEY;
const DD_APP_KEY = process.env.DD_APP_KEY;
const DD_SITE = process.env.DD_SITE || "us5.datadoghq.com";

if (!DD_API_KEY || !DD_APP_KEY) {
  console.error("DD_API_KEY and DD_APP_KEY environment variables are required");
  process.exit(1);
}

const headers = {
  "DD-API-KEY": DD_API_KEY,
  "DD-APPLICATION-KEY": DD_APP_KEY,
  "Content-Type": "application/json",
};

async function ddRequest(method, path, body) {
  const url = `https://api.${DD_SITE}${path}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Datadog API ${res.status}: ${text}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "datadog",
  version: "1.0.0",
});

// --- search_logs ---
server.tool(
  "search_logs",
  "Search Datadog logs by query, service, time range. Uses Datadog log search syntax.",
  {
    query: z.string().describe("Datadog log search query (e.g. 'service:web-app status:error')"),
    from: z.string().optional().describe("Start time — ISO-8601 or relative like 'now-1h' (default: now-15m)"),
    to: z.string().optional().describe("End time — ISO-8601 or relative like 'now' (default: now)"),
    limit: z.number().optional().describe("Max results to return (default: 25, max: 100)"),
    sort: z.enum(["timestamp", "-timestamp"]).optional().describe("Sort order (default: -timestamp, newest first)"),
  },
  async ({ query, from, to, limit, sort }) => {
    const body = {
      filter: {
        query,
        from: from || "now-15m",
        to: to || "now",
      },
      sort: sort || "-timestamp",
      page: { limit: Math.min(limit || 25, 100) },
    };
    const data = await ddRequest("POST", "/api/v2/logs/events/search", body);
    const logs = (data.data || []).map((log) => ({
      id: log.id,
      timestamp: log.attributes?.timestamp,
      service: log.attributes?.service,
      status: log.attributes?.status,
      message: log.attributes?.message?.substring(0, 500),
      host: log.attributes?.host,
      tags: log.attributes?.tags,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ total: logs.length, logs }, null, 2),
        },
      ],
    };
  }
);

// --- query_metrics ---
server.tool(
  "query_metrics",
  "Query Datadog time series metrics. Returns data points for a metric query.",
  {
    query: z.string().describe("Datadog metrics query (e.g. 'avg:system.cpu.user{service:web-app}')"),
    from: z.number().optional().describe("Start time as Unix epoch seconds (default: 1 hour ago)"),
    to: z.number().optional().describe("End time as Unix epoch seconds (default: now)"),
  },
  async ({ query, from, to }) => {
    const now = Math.floor(Date.now() / 1000);
    const fromTs = from || now - 3600;
    const toTs = to || now;
    const params = new URLSearchParams({ query, from: String(fromTs), to: String(toTs) });
    const data = await ddRequest("GET", `/api/v1/query?${params}`);
    const series = (data.series || []).map((s) => ({
      metric: s.metric,
      scope: s.scope,
      pointCount: s.pointlist?.length || 0,
      points: (s.pointlist || []).slice(-10).map(([ts, val]) => ({
        time: new Date(ts).toISOString(),
        value: val,
      })),
      unit: s.unit?.[0]?.name,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ query, from: fromTs, to: toTs, series }, null, 2),
        },
      ],
    };
  }
);

// --- search_traces ---
server.tool(
  "search_traces",
  "Search Datadog APM traces/spans by service, resource, or error status.",
  {
    query: z.string().describe("Trace search query (e.g. 'service:web-app @http.status_code:500')"),
    from: z.string().optional().describe("Start time — ISO-8601 or relative like 'now-1h' (default: now-15m)"),
    to: z.string().optional().describe("End time — ISO-8601 or relative like 'now' (default: now)"),
    limit: z.number().optional().describe("Max results (default: 25, max: 50)"),
  },
  async ({ query, from, to, limit }) => {
    const body = {
      filter: {
        query,
        from: from || "now-15m",
        to: to || "now",
      },
      sort: "-timestamp",
      page: { limit: Math.min(limit || 25, 50) },
    };
    const data = await ddRequest("POST", "/api/v2/spans/events/search", body);
    const spans = (data.data || []).map((span) => ({
      id: span.id,
      traceId: span.attributes?.trace_id,
      service: span.attributes?.service,
      resource: span.attributes?.resource,
      name: span.attributes?.name,
      duration: span.attributes?.duration,
      status: span.attributes?.status,
      error: span.attributes?.error,
      timestamp: span.attributes?.timestamp,
      tags: span.attributes?.tags,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ total: spans.length, spans }, null, 2),
        },
      ],
    };
  }
);

// --- list_monitors ---
server.tool(
  "list_monitors",
  "List Datadog monitors, optionally filtered by name, tag, or status.",
  {
    name: z.string().optional().describe("Filter monitors by name substring"),
    tags: z.string().optional().describe("Comma-separated tags to filter by (e.g. 'service:web-app,env:prod')"),
    monitor_tags: z.string().optional().describe("Comma-separated monitor tags to filter by"),
  },
  async ({ name, tags, monitor_tags }) => {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (tags) params.set("tags", tags);
    if (monitor_tags) params.set("monitor_tags", monitor_tags);
    const paramStr = params.toString();
    const path = `/api/v1/monitor${paramStr ? "?" + paramStr : ""}`;
    const data = await ddRequest("GET", path);
    const monitors = (Array.isArray(data) ? data : []).map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      status: m.overall_state,
      message: m.message?.substring(0, 200),
      tags: m.tags,
      created: m.created,
      modified: m.modified,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ total: monitors.length, monitors }, null, 2),
        },
      ],
    };
  }
);

// --- get_log_details ---
server.tool(
  "get_log_details",
  "Get the full details of a specific log event by ID.",
  {
    log_id: z.string().describe("The log event ID"),
  },
  async ({ log_id }) => {
    // Use search with the specific log ID
    const body = {
      filter: {
        query: `@id:${log_id}`,
        from: "now-30d",
        to: "now",
      },
      page: { limit: 1 },
    };
    const data = await ddRequest("POST", "/api/v2/logs/events/search", body);
    const log = data.data?.[0];
    if (!log) {
      return { content: [{ type: "text", text: "Log not found" }] };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(log.attributes, null, 2),
        },
      ],
    };
  }
);

// --- list_services ---
server.tool(
  "list_services",
  "List services observed in APM. Useful for discovering service names before querying.",
  {
    env: z.string().optional().describe("Environment filter (e.g. 'prod', 'sandbox')"),
  },
  async ({ env }) => {
    const params = new URLSearchParams();
    if (env) params.set("env", env);
    const paramStr = params.toString();
    const data = await ddRequest("GET", `/api/v1/service_dependencies${paramStr ? "?" + paramStr : ""}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
