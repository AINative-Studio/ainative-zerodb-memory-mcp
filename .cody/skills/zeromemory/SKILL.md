---
name: zeromemory
description: Use ZeroDB persistent memory to store and recall facts, decisions, and context across agent sessions. Invoke when storing user preferences, project context, implementation decisions, or searching prior conversation history.
---

# ZeroMemory Skill

Gives agents persistent cognitive memory across sessions using ZeroDB.

## When to Use

- User references something from a prior session
- You complete significant work and want future sessions to have context
- User asks about preferences, history, or decisions made earlier
- You need to recall facts before answering a question

## Store a Memory

```
zerodb_store_memory(
  content="<what to remember>",
  session_id="<current session id>",
  role="assistant",         # user | assistant | system
  tags=["tag1", "tag2"],
  importance=0.8            # 0.0–1.0, optional
)
```

## Search Memory

```
zerodb_search_memory(
  query="<natural language query>",
  session_id="<current session id>",
  scope="session",          # session | agent | global
  limit=10
)
```

## Get Full Context

```
zerodb_get_context(session_id="<current session id>")
```

## Rules

- **Always pass session_id** — without it, memory lands in `global` namespace
- Search before answering questions about history or preferences
- Store after completing tasks, making architectural decisions, or learning user preferences
- Use descriptive tags for better future retrieval
