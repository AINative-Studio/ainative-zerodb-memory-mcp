/**
 * ZeroDBClient.initialize() must not block on the advisory auth-validation
 * network round-trip (core#33 / ainative-zerodb-memory-mcp#33).
 *
 * Root cause: initialize() awaited authenticate() (fast for API-key auth --
 * zero network calls) AND THEN validateAuth(), a second, genuinely optional
 * network round-trip (POST .../memory/v2/recall or GET .../auth/me, each
 * with a 10s timeout) purely to log a confirmation message. index.js's
 * main() awaits initialize() in full BEFORE server.connect(transport) is
 * ever called, so the MCP stdio transport does not exist yet during this
 * window -- any client with a health-check timeout shorter than the
 * round-trip (reported: 5-12s with npx, matching the full validateAuth
 * network latency) sees "failed to connect", even though tools/list and
 * resources/list don't require auth and the whole validation step is only
 * used for a console.error() message, never for gating tool calls (tool
 * calls already fail their own real 401 at call time if the key is bad --
 * see authValid=false handling in authenticate()/validateAuth()).
 *
 * Fix: validateAuth() still runs, but initialize() does not await it --
 * it fires the validation in the background and resolves as soon as
 * authenticate() (synchronous for API-key auth) completes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('ZeroDBClient.initialize() startup latency (core#33)', () => {
  it('resolves without waiting for validateAuth()\'s network round-trip', async (t) => {
    let validateAuthResolve;
    const validateAuthStarted = new Promise((resolve) => {
      validateAuthResolve = resolve;
    });

    t.mock.module('axios', {
      defaultExport: {
        get: async (url) => {
          if (url.includes('/health')) {
            throw new Error('ECONNREFUSED'); // no ZeroLocal running
          }
          throw new Error('unexpected axios.get in this test');
        },
        post: async (url) => {
          if (url.includes('/memory/v2/recall') || url.includes('/auth/me')) {
            // Simulate the slow backend round-trip from the issue repro --
            // this must NOT be awaited by initialize().
            validateAuthResolve();
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return { status: 200, data: {} };
          }
          throw new Error('unexpected axios.post in this test');
        },
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      apiKey: 'ak_test_key',
    });

    const start = Date.now();
    await client.initialize();
    const elapsedMs = Date.now() - start;

    assert.ok(
      elapsedMs < 1000,
      `initialize() took ${elapsedMs}ms -- it must not block on validateAuth()'s network call`
    );

    // The validation round-trip was at least kicked off in the background,
    // it's just not blocking initialize()'s return.
    await validateAuthStarted;
  });

  it('still sets authValid=true once the background validation succeeds', async (t) => {
    t.mock.module('axios', {
      defaultExport: {
        get: async () => { throw new Error('ECONNREFUSED'); },
        post: async () => ({ status: 200, data: {} }),
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      apiKey: 'ak_test_key',
    });

    await client.initialize();
    // authValid may still be undefined/pending immediately after initialize()
    // resolves (validation is backgrounded) -- give the background promise
    // a turn to settle, then confirm it landed.
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(client.authValid, true);
  });

  it('still sets authValid=false if the background validation fails, without throwing', async (t) => {
    t.mock.module('axios', {
      defaultExport: {
        get: async () => { throw new Error('ECONNREFUSED'); },
        post: async () => {
          const err = new Error('Request failed with status code 401');
          err.response = { status: 401, data: { detail: 'Invalid API key' } };
          throw err;
        },
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      apiKey: 'ak_bad_key',
    });

    await assert.doesNotReject(() => client.initialize());
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(client.authValid, false);
  });
});
