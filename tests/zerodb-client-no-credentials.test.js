/**
 * ZeroDBClient.authenticate() with NO credentials at all
 *
 * Covers ZeroDB.AINative.Studio#306: an anonymous scanning probe
 * (e.g. ora.ai's agent-readiness scanner, or any MCP client that spawns
 * `npx ainative-zerodb-memory-mcp` with no ZERODB_API_KEY / ZERODB_USERNAME
 * / ZERODB_PASSWORD set, and whose auto-provision fallback also fails,
 * e.g. HTTP 429) must still be able to complete `initialize` and
 * `tools/list` / `resources/list` over the stdio transport.
 *
 * Today, ZeroDBClient.authenticate() throws synchronously when there are
 * no credentials (zerodb-client.js:80-82). That throw propagates out of
 * initialize() -> main()'s try/catch -> process.exit(1) in index.js,
 * which happens BEFORE server.connect(transport) is ever reached. From
 * any MCP client's point of view this looks exactly like
 * CONNECTION_CLOSED: the stdio transport never connects, the server
 * never answers `initialize`, and `tools/list`/`resources/list` are
 * never reachable -- even though neither of those requires auth.
 *
 * This is the same bug *shape* already fixed for bad/slow username-password
 * credentials under core#246 (see zerodb-client-auth.test.js) -- but that
 * fix left the zero-credentials branch (lines 80-82) untouched, since it's
 * a different code path (missing credentials entirely, not bad ones).
 *
 * Fix: authenticate() must behave the same way for "no credentials" as it
 * already does for "bad credentials" -- set authValid = false and return,
 * instead of throwing. Tool calls that need auth still fail with a clear
 * error; introspection (initialize/tools/list/resources/list) succeeds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('ZeroDBClient.authenticate() with no credentials at all', () => {
  it('does not throw when neither ZERODB_API_KEY nor ZERODB_USERNAME/PASSWORD are set', async () => {
    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      // no apiKey, no username, no password
    });

    // Must resolve, not reject -- a thrown error here is fatal to the
    // whole MCP server process before the stdio transport ever connects,
    // which is exactly the "connection failed" symptom ora.ai's scanner saw.
    await assert.doesNotReject(() => client.authenticate());

    assert.strictEqual(client.authValid, false);
    assert.strictEqual(client.token, null);
  });

  it('initialize() does not throw with no credentials, so the MCP server can still start and serve anonymous introspection', async () => {
    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
    });

    await assert.doesNotReject(() => client.initialize());
    assert.strictEqual(client.authValid, false);
  });
});
