# Datadog MCP Server

MCP server for querying Datadog logs, metrics, APM traces, and monitors from Claude Code.

## Setup

1. Install dependencies:
```bash
cd datadog-mcp-server && npm install
```

2. Set environment variables (add to your shell profile):
```bash
export DD_API_KEY="your-datadog-api-key"
export DD_APP_KEY="your-datadog-application-key"
```

Get your API key from: https://us5.datadoghq.com/organization-settings/api-keys
Get your App key from: https://us5.datadoghq.com/organization-settings/application-keys

3. Add to Claude Code settings (`~/.claude/settings.json`):
```json
"datadog": {
  "command": "node",
  "args": ["/path/to/datadog-mcp-server/index.js"],
  "env": {
    "DD_API_KEY": "$DD_API_KEY",
    "DD_APP_KEY": "$DD_APP_KEY",
    "DD_SITE": "us5.datadoghq.com"
  }
}
```

4. Restart Claude Code.

## Tools

| Tool | Description |
|------|-------------|
| `search_logs` | Search logs by query, service, time range |
| `query_metrics` | Query time series metrics |
| `search_traces` | Search APM traces/spans |
| `list_monitors` | List monitors and their status |
| `get_log_details` | Get full details of a specific log event |
| `list_services` | Discover service names in APM |

## Example Queries

```
search_logs: query="service:gw-realtime status:error" from="now-1h"
query_metrics: query="avg:system.cpu.user{service:gw-realtime}"
search_traces: query="service:gw-realtime @http.status_code:500" from="now-1h"
list_monitors: tags="service:gw-realtime"
```
