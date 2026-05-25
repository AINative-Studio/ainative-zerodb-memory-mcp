# ZeroDB Memory MCP — Cody Usage Guide

This package provides persistent cognitive memory for AI agents via the `zerodb-memory` MCP server.

## Available Tools

| Tool | Description |
|------|-------------|
| `zerodb_store_memory` | Store a memory with automatic importance scoring |
| `zerodb_search_memory` | Semantic search across agent memory |
| `zerodb_get_context` | Get full context window for a session |
| `zerodb_clear_session` | Clear all memories for a session |
| `zerodb_embed_text` | Embed text for vector operations |
| `zerodb_synthesize_context` | Synthesize a context summary from memories |
| `zerodb_semantic_search` | Vector similarity search |
| `zerodb_configure_auto_context` | Configure auto-context middleware |
| `zerodb_get_auto_context_config` | Get current auto-context configuration |

## Behavior Rules

1. **Always pass session_id** — scopes memory to `session:<id>` namespace. Without it, writes land in `global` and pollute shared memory.

2. **Search before answering** — when the user references prior work, preferences, or context, call `zerodb_search_memory` first.

3. **Store after significant work** — after completing a task, store a concise summary so the next session has context.

4. **Tag memories** — use tags like `["auth", "implementation"]` or `["preference", "stack"]` for better retrieval.

## Quick Reference

```bash
# Store
zerodb_store_memory(content, session_id, role, tags)

# Search
zerodb_search_memory(query, session_id, scope="session", limit=10)

# Get full context
zerodb_get_context(session_id)
```

## MCP Config (mcp.json)

**Recommended — HTTP transport (always current, no cache issues):**

```json
{
  "mcpServers": {
    "zerodb-memory": {
      "type": "http",
      "url": "https://api.ainative.studio/v1/mcp/zerodb-memory-mcp/messages",
      "headers": { "x-api-key": "ak_your_key" }
    }
  }
}
```

**Alternative — stdio/npx:**

```json
{
  "mcpServers": {
    "zerodb-memory": {
      "command": "npx",
      "args": ["-y", "ainative-zerodb-memory-mcp@latest"],
      "env": {
        "ZERODB_API_KEY": "ak_your_key",
        "ZERODB_API_URL": "https://api.ainative.studio"
      }
    }
  }
}
```

## Auth

- `ZERODB_API_KEY=ak_...` — recommended
- `ZERODB_USERNAME` + `ZERODB_PASSWORD` — JWT (auto-refreshes)
