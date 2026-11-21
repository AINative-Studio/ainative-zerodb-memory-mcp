# ZeroDB Agent Memory MCP Server

MCP server providing 18 tools for AI agent memory: 9 memory tools, 4
plan-artifact tools, and 5 write-back tools. Published as
`ainative-zerodb-memory-mcp` on npm. Plain Node.js (`type: module`, no
TypeScript build step).

## Project Structure

See [AGENTS.md](./AGENTS.md) for the canonical project structure, key
constraints, and agent-facing conventions (this file and AGENTS.md should
stay in sync -- if one changes, check the other).

- `index.js` — MCP server entry point
- `src/tools/` — the 9 memory, 4 plan-artifact, and 5 write-back tools
- `src/client/zerodb-client.js` — HTTP client talking to the ZeroDB backend
- `src/utils/memory-manager.js` — scope/session resolution logic
- `tests/*.test.js` — Node's built-in test runner (`node --test`)

## Critical Rules

- **Tests before commits** — `npm test` (Node's built-in test runner, not
  Jest/Mocha).
- **No AI attribution** in commits.
- **Versioning discipline**: bump `package.json`'s `version` (and
  `server.json` to match) and `npm publish` whenever a change affects
  runtime behavior — a merged-but-unpublished fix is invisible to every
  consumer running `npx ainative-zerodb-memory-mcp@latest`.
- **Backend namespace model**: only `global` and `session:<id>` namespaces
  exist. Don't reintroduce a fictional per-agent namespace.
- **No build step**: don't add TypeScript or a bundler without discussing
  it first — every consumer runs this via `npx` against the published JS.

## Common Tasks

```bash
# Run the full test suite
npm test

# With coverage
npm run test:coverage

# Start locally
npm start
```

## Auto-Provisioning

This MCP server auto-provisions a free ZeroDB instant-db project/API key
on first run when no credentials are set (see `index.js`'s startup
sequence). **Do not remove or modify this fallback** without explicit
approval -- it's what lets `npx ainative-zerodb-memory-mcp` work out of
the box with zero signup.
