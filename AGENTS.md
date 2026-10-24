# Agent Instructions

Instructions for AI coding agents (Claude Code, Cursor, Windsurf, etc.) working in this repository.

## What this repo is

An MCP (Model Context Protocol) server providing 18 tools for AI agent memory: 9 memory tools (store/search/semantic-search/context/embedding/session management), 4 plan-artifact tools (persistent plans/PRDs with diff history across sessions), and 5 write-back tools (Slack, Gmail, Calendar, GitHub, Notion). Plain Node.js (no TypeScript build step), `type: module`.

## Project structure

- `index.js` — MCP server entry point
- `src/tools/memory-tools.js` — the 9 memory tools
- `src/tools/plan-tools.js` — the 4 plan-artifact tools
- `src/tools/writeback-tools.js` — the 5 write-back tools
- `src/client/zerodb-client.js` — HTTP client talking to the ZeroDB backend (`POST /api/v1/public/memory/v2/recall` and `/remember`)
- `src/utils/memory-manager.js` — scope/session resolution logic sitting between the tools and the client
- `tests/*.test.js` — Node's built-in test runner (`node --test`), no Jest/Mocha

## Running tests

```bash
npm test             # node --test tests/*.test.js
npm run test:coverage  # same, with c8 coverage
```

Always run tests before committing. No separate lint/build step — this is plain JS.

## Key constraints

- **Backend namespace model**: the ZeroDB backend only recognizes two namespaces — `global` and `session:<id>` (see `_validate_namespace` in the core backend). There is no per-agent namespace. `scope: 'agent'` and `scope: 'global'` are therefore equivalent in `zerodb-client.js` — both search broadly; only `scope: 'session'` narrows the query, and it requires a `sessionId`. Don't reintroduce a fictional per-agent scope without a corresponding backend change.
- **No build step**: this package ships plain JS directly (see `package.json`'s lack of a `build` script). Don't add TypeScript or a bundler without discussing it first — every consumer currently runs this via `npx` against the published JS.
- **Versioning discipline**: bump `package.json`'s `version` and publish to npm (`npm publish`) whenever a change affects runtime behavior — a merged-but-unpublished fix is invisible to every consumer running `npx ainative-zerodb-memory-mcp@latest`.

## Where to look first

- `.cody/` and `.claude/` — repo-specific skill/agent configuration, if present
- `README.md` — the full 18-tool catalog with usage examples
- `server.json` — MCP server registry manifest
