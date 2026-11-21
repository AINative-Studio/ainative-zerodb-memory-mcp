# ZeroDB Agent Memory MCP Server

Focused MCP server with 18 tools (9 memory + 5 write-back + 4 plan-artifact)
for agent memory management, context synthesis, and write-back actions to
external services. Published as `ainative-zerodb-memory-mcp` on npm.

## Project Structure

- `index.js` — MCP server entry point and tool dispatch
- `src/client/zerodb-client.js` — ZeroDB API client (auth, auto-detect
  ZeroLocal vs. Cloud)
- `src/tools/memory-tools.js` — 9 memory tools
- `src/tools/writeback-tools.js` — 5 write-back tools
- `src/tools/plan-tools.js` — 4 plan-artifact tools
- `src/utils/memory-manager.js` — context window management, pruning,
  decay/importance scoring
- `src/utils/auto-context.js` — auto-context and auto-trace hooks
- `tests/` — tests using Node's built-in `node:test` runner

## Critical Rules

- **Tests before commits** — this is a JavaScript/Node ESM package;
  tests run via `npm test` (Node's native test runner), not pytest.
- **No AI attribution** in commits.
- **Startup must stay fast.** `index.js` reports "MCP Server connected
  and ready" to stdout/stderr for MCP clients with tight health-check
  timeouts (confirmed live: Cody CLI). Do not add a blocking network
  call to the startup path (`initialize()`) without first checking it
  can't be deferred — see #33's fix for the pattern (fire-and-forget a
  diagnostic call rather than awaiting it before reporting ready).
- **All tools must have proper JSON schema definitions.**
- **New tools require tests.**
- When adding or removing a tool, update the tool count everywhere it's
  stated (this file, README, the `index.js` header comment AND its
  runtime log line) — a stale count in one place while another is
  correct is exactly the kind of inconsistency that undermines
  confidence when someone checks a second source.

## Common Tasks

```bash
# Run the full test suite with coverage
npm run test:coverage

# Run tests without coverage
npm test

# Start the server directly (for manual testing)
npm start
```

## Auth & Connectivity

Supports two auth modes: `ZERODB_API_KEY` (recommended, no expiry) or
`ZERODB_USERNAME`/`ZERODB_PASSWORD` (JWT, refreshed every 50 minutes).
Auto-detects ZeroLocal (`localhost:8000`) vs. ZeroDB Cloud
(`api.ainative.studio`) unless `ZERODB_API_URL` is set explicitly.
Missing or invalid credentials must never throw during startup — the
server degrades gracefully (`authValid = false`) and lets
auth-dependent tools fail individually at call time, so the MCP stdio
transport always connects.
