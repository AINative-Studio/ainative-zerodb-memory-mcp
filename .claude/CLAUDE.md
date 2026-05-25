# ZeroDB Memory MCP — Usage Guide

This package provides persistent cognitive memory for AI agents via the `ainative-zerodb-memory` MCP server.

## Available Tools

| Tool | Description |
|------|-------------|
| `zerodb_store_memory` | Store a memory with automatic importance scoring and embedding |
| `zerodb_search_memory` | Semantic search across agent memory |
| `zerodb_get_context` | Get full context window for a session |
| `zerodb_clear_session` | Clear all memories for a session |
| `zerodb_embed_text` | Embed text for vector operations |
| `zerodb_synthesize_context` | Synthesize a context summary from memories |
| `zerodb_semantic_search` | Vector similarity search |
| `zerodb_configure_auto_context` | Configure auto-context middleware |
| `zerodb_get_auto_context_config` | Get current auto-context configuration |

## How to Use Memory Effectively

### Always use a consistent session_id
Every store and search call should pass the same `session_id` to scope memories to the current conversation. This ensures writes and reads hit the same `session:<id>` namespace.

```
zerodb_store_memory(
  content="User is working on a FastAPI backend with PostgreSQL",
  session_id="my-session-123",
  role="user",
  tags=["context", "stack"]
)
```

### Search before answering
Before answering questions about the user's project, preferences, or history — search memory first:

```
zerodb_search_memory(
  query="user's tech stack and preferences",
  session_id="my-session-123",
  scope="session"
)
```

### Store important decisions and facts
After completing significant work, store a summary so future sessions have context:

```
zerodb_store_memory(
  content="Implemented OAuth2 login with JWT tokens. Uses RS256. Refresh tokens stored in Redis.",
  session_id="my-session-123",
  role="assistant",
  tags=["auth", "implementation"]
)
```

## Namespace Rules

- `session_id` present → namespace `session:<session_id>` (scoped, private)
- No `session_id` → namespace `global` (shared across sessions)

Always pass `session_id` to avoid polluting the global namespace.

## MCP Config

**Recommended — HTTP transport (always current, no npx cache issues):**

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

## Auth

Set one of:
- `ZERODB_API_KEY=ak_...` — API key auth
- `ZERODB_USERNAME` + `ZERODB_PASSWORD` — JWT auth (auto-refreshes)

API base: `https://api.ainative.studio`
