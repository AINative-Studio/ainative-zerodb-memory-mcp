/**
 * ZeroDBClient authenticate() Tests
 *
 * Covers core#246 / ZeroDB.AINative.Studio#246: a username/password
 * login failure (slow response, network error, bad credentials) must
 * not throw out of authenticate(), because an uncaught throw here
 * propagates through initialize() -> main()'s try/catch -> process.exit(1),
 * which happens BEFORE server.connect(transport) is ever called in
 * index.js. From the MCP client's point of view this looks exactly
 * like CONNECTION_CLOSED: the stdio transport never connects at all,
 * instead of the server starting and only the auth-dependent tools
 * failing (which is how API-key auth failures already behave via
 * validateAuth()'s authValid=false pattern).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// t.mock.module requires Node >=20.1 run with --experimental-test-module-mocks
// (this package's package.json declares engines.node >=18.0.0). Skip rather
// than fail on an older runtime -- the regular test suite still exercises
// the rest of the client; this file adds coverage specifically for the
// core#246 / ZeroDB.AINative.Studio#246 fix.
const [major, minor] = process.versions.node.split('.').map(Number);
const supportsModuleMocks = major > 20 || (major === 20 && minor >= 1);

describe('ZeroDBClient.authenticate() with username/password', { skip: !supportsModuleMocks && 'requires Node >=20.1 run with --experimental-test-module-mocks' }, () => {
  it('does not throw when the login request times out (must stay non-fatal, matching validateAuth()\'s pattern)', async (t) => {
    t.mock.module('axios', {
      defaultExport: {
        post: async () => {
          const err = new Error('timeout of 10000ms exceeded');
          err.code = 'ECONNABORTED';
          throw err;
        },
        get: async () => ({ status: 200, data: {} }),
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      username: 'user@example.com',
      password: 'wrong-or-slow',
    });

    // Must resolve, not reject -- a thrown error here is fatal to the
    // whole MCP server process before the stdio transport ever connects.
    await assert.doesNotReject(() => client.authenticate());

    assert.strictEqual(client.authValid, false);
    assert.strictEqual(client.token, null);
  });

  it('does not throw on invalid credentials (401)', async (t) => {
    t.mock.module('axios', {
      defaultExport: {
        post: async () => {
          const err = new Error('Request failed with status code 401');
          err.response = { status: 401, data: { detail: 'Invalid credentials' } };
          throw err;
        },
        get: async () => ({ status: 200, data: {} }),
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      username: 'user@example.com',
      password: 'wrong',
    });

    await assert.doesNotReject(() => client.authenticate());
    assert.strictEqual(client.authValid, false);
  });

  it('still authenticates successfully on a valid login response', async (t) => {
    t.mock.module('axios', {
      defaultExport: {
        post: async (url, body) => {
          assert.ok(url.endsWith('/api/v1/auth/login'));
          assert.strictEqual(body.email, 'user@example.com');
          return { status: 200, data: { access_token: 'jwt-token-abc' } };
        },
        get: async () => ({ status: 200, data: {} }),
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      username: 'user@example.com',
      password: 'correct',
    });

    await client.authenticate();

    assert.strictEqual(client.token, 'jwt-token-abc');
    assert.notStrictEqual(client.authValid, false);
  });

  it('sends a bounded timeout on the login request, so a hung backend cannot hang the whole MCP server startup', async (t) => {
    let capturedConfig;
    t.mock.module('axios', {
      defaultExport: {
        post: async (url, body, config) => {
          capturedConfig = config;
          return { status: 200, data: { access_token: 'jwt-token-abc' } };
        },
        get: async () => ({ status: 200, data: {} }),
      },
    });

    const { ZeroDBClient } = await import('../src/client/zerodb-client.js?t=' + Date.now() + Math.random());
    const client = new ZeroDBClient({
      apiUrl: 'https://api.ainative.studio',
      username: 'user@example.com',
      password: 'correct',
    });

    await client.authenticate();

    assert.ok(capturedConfig, 'axios.post must be called with a config object');
    assert.ok(
      typeof capturedConfig.timeout === 'number' && capturedConfig.timeout > 0,
      `expected a positive numeric timeout on the login request, got: ${JSON.stringify(capturedConfig)}`
    );
  });
});
