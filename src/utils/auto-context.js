/**
 * Auto-Context Middleware — Issue #2678
 *
 * Before-tool hook that injects relevant memories as context before each
 * MCP tool call. Configurable per agent_id. Disabled by default (opt-in).
 *
 * Config keys per agent_id:
 *   enabled            boolean  — whether auto-context is active (default: false)
 *   max_results        integer  — memories to inject (1-20, default: 10)
 *   synthesis_style    string   — narrative | bullet | structured (default: bullet)
 *   auto_trace         boolean  — store tool responses as memories (default: false)
 */

// In-process config store. Persisted to backend on set, read from backend on
// cold start. Falls back to in-memory if backend is unreachable.
const _configCache = new Map();

const DEFAULTS = {
  enabled: false,
  max_results: 10,
  synthesis_style: 'bullet',
  auto_trace: false,
};

/**
 * Retrieve auto-context config for an agent from cache or backend.
 */
export async function getAutoContextConfig(agentId, client) {
  if (_configCache.has(agentId)) {
    return _configCache.get(agentId);
  }

  // Try loading from backend profile metadata
  try {
    const profile = await client.request('GET', `/api/v1/public/memory/v2/profile/${agentId}`);
    const saved = profile?.auto_context_config;
    if (saved && typeof saved === 'object') {
      const config = { ...DEFAULTS, ...saved };
      _configCache.set(agentId, config);
      return config;
    }
  } catch (_) {
    // Profile not found or backend unreachable — use defaults
  }

  const config = { ...DEFAULTS };
  _configCache.set(agentId, config);
  return config;
}

/**
 * Persist auto-context config for an agent.
 * Stores config in backend memory as a semantic memory tagged 'auto_context_config'.
 * Also updates in-process cache immediately.
 */
export async function setAutoContextConfig(agentId, patch, client) {
  const current = await getAutoContextConfig(agentId, client);
  const next = { ...current, ...sanitizePatch(patch) };
  _configCache.set(agentId, next);

  // Persist via remember endpoint so it survives restarts
  try {
    await client.request('POST', '/api/v1/public/memory/v2/remember', {
      content: JSON.stringify({ auto_context_config: next }),
      entity_id: agentId,
      memory_type: 'semantic',
      importance: 1.0,
      tags: ['auto_context_config', 'system'],
    });
  } catch (err) {
    console.error(`[auto-context] Failed to persist config for ${agentId}: ${err.message}`);
  }

  return next;
}

/**
 * Validate and clamp config patch values.
 */
function sanitizePatch(patch) {
  const out = {};
  if (patch.enabled !== undefined) out.enabled = Boolean(patch.enabled);
  if (patch.max_results !== undefined) out.max_results = Math.min(20, Math.max(1, parseInt(patch.max_results) || 10));
  if (['narrative', 'bullet', 'structured'].includes(patch.synthesis_style)) out.synthesis_style = patch.synthesis_style;
  if (patch.auto_trace !== undefined) out.auto_trace = Boolean(patch.auto_trace);
  return out;
}

/**
 * Auto-context middleware hook.
 *
 * Call BEFORE executing a tool. If enabled for this agent, retrieves relevant
 * memories and returns a context string to prepend to the tool's response.
 * Returns null if disabled or on any error (never blocks tool execution).
 *
 * @param {string} agentId   - agent identifier
 * @param {string} query     - the last user message or tool input summary
 * @param {object} client    - ZeroDBClient instance
 * @returns {string|null}    - context string or null
 */
export async function autoContextHook(agentId, query, client) {
  if (!agentId || !query) return null;

  let config;
  try {
    config = await getAutoContextConfig(agentId, client);
  } catch (_) {
    return null;
  }

  if (!config.enabled) return null;

  try {
    const result = await client.synthesizeContext({
      query,
      agentId,
      synthesisStyle: config.synthesis_style,
      maxTokens: 800,
      topK: config.max_results,
    });
    return result?.context || null;
  } catch (err) {
    console.error(`[auto-context] Recall failed for ${agentId}: ${err.message}`);
    return null;
  }
}

/**
 * Auto-trace hook.
 *
 * Call AFTER a tool responds. If auto_trace is enabled, stores the response
 * as a new memory so future recalls can surface it.
 *
 * @param {string} agentId      - agent identifier
 * @param {string} toolName     - name of the tool that ran
 * @param {object} toolResult   - result returned by the tool
 * @param {object} client       - ZeroDBClient instance
 */
export async function autoTraceHook(agentId, toolName, toolResult, client) {
  if (!agentId) return;

  let config;
  try {
    config = await getAutoContextConfig(agentId, client);
  } catch (_) {
    return;
  }

  if (!config.enabled || !config.auto_trace) return;

  try {
    const summary = typeof toolResult === 'string'
      ? toolResult
      : JSON.stringify(toolResult).slice(0, 1000);

    await client.request('POST', '/api/v1/public/memory/v2/remember', {
      content: `[auto-trace] ${toolName}: ${summary}`,
      entity_id: agentId,
      memory_type: 'episodic',
      importance: 0.4,
      tags: ['auto_trace', toolName],
    });
  } catch (err) {
    console.error(`[auto-context] Auto-trace failed: ${err.message}`);
  }
}
