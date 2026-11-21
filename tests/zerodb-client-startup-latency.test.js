/**
 * ZeroDBClient.initialize() startup-latency tests
 *
 * Refs #33: the MCP server took 5-12 seconds to report "connected and
 * ready", causing health-check failures in Cody CLI and other clients
 * with shorter timeouts. Root cause, confirmed by reading the real code
 * (not the issue's own guess that ASCII-art printing was the cause --
 * console.error is synchronous and fast, that was a red herring):
 * initialize() awaited validateAuth(), which makes a real network call
 * (a memory-search POST for API-key auth, or GET /auth/me for
 * username/password) with a 10s timeout, BEFORE returning -- and
 * index.js awaits initialize() before calling server.connect(transport),
 * so the real "server ready" signal was gated on that network round
 * trip's latency, not on anything the server actually needs to start
 * serving requests. ensureAuthenticated() already re-validates lazily at
 * first real tool-call time, so validateAuth() at startup is purely an
 * early diagnostic, not a correctness requirement.
 *
 * Fix: initialize() must not await validateAuth() -- fire it and let it
 * resolve in the background; authValid is still set (just slightly
 * later), and any auth problem still surfaces via the existing
 * authValid === false / 401-at-call-time paths.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsModuleMocks = major > 20 || (major === 20 && minor >= 1);

describe('ZeroDBClient.initialize() does not block startup on validateAuth()', {
  skip: !supportsModuleMocks && 'requires Node >=20.1 run with --experimental-test-module-mocks',
}, () => {
  it('resolves quickly even when validateAuth()\'s network call is slow (API key auth)', async (t) => {
    let getCallCount = 0;
    t.mock.module('axios', {
      defaultExport: {
        post: async (url) => {
          // The validateAuth() memory-search call -- deliberately slow,
          // simulating the real-world latency the issue reported (a real
          // semantic-search round trip, not an instant health check).
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return { status: 200, data: { results: [] } };
        },
        get: async (url) => {
          getCallCount += 1;
          if (url.endsWith('/health')) {
            // autoDetectEndpoint()'s localhost probe -- not relevant here
            // since apiUrl is explicitly provided, but mock it anyway so a
            // stray call doesn't hang the test.
            throw new Error('ECONNREFUSED');
          }
          return { status: 200, data: {} };
        },
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      apiKey: 'sk_test_key',
    });

    const start = Date.now();
    await client.initialize();
    const elapsedMs = Date.now() - start;

    assert.ok(
      elapsedMs < 1000,
      `initialize() took ${elapsedMs}ms -- must not block on validateAuth()'s 2000ms network call`
    );
  });

  it('still sets authValid=true once the background validateAuth() call actually completes', async (t) => {
    t.mock.module('axios', {
      defaultExport: {
        post: async () => ({ status: 200, data: { results: [] } }),
        get: async () => ({ status: 200, data: {} }),
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      apiKey: 'sk_test_key',
    });

    await client.initialize();
    // Give the fire-and-forget validateAuth() a tick to actually resolve.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(client.authValid, true);
  });

  it('still sets authValid=false if the background validateAuth() call fails', async (t) => {
    t.mock.module('axios', {
      defaultExport: {
        post: async () => {
          const err = new Error('Request failed with status code 401');
          err.response = { status: 401, data: { detail: 'Invalid API key' } };
          throw err;
        },
        get: async () => ({ status: 200, data: {} }),
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      apiKey: 'sk_bad_key',
    });

    await client.initialize();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(client.authValid, false);
  });
});
