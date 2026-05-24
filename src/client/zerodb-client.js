/**
 * ZeroDB API Client
 * Supports both ZeroLocal (localhost:8000) and ZeroDB Cloud (api.ainative.studio)
 * Auto-detects available endpoint
 */

import axios from 'axios';

export class ZeroDBClient {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || process.env.ZERODB_API_URL || null;
    this.username = config.username || process.env.ZERODB_USERNAME;
    this.password = config.password || process.env.ZERODB_PASSWORD;
    this.apiKey = config.apiKey || process.env.ZERODB_API_KEY;  // Support API key authentication
    this.projectId = config.projectId || process.env.ZERODB_PROJECT_ID;
    this.token = null;
    this.tokenExpiry = null;
    this.isLocal = false;
  }

  /**
   * Initialize client - auto-detect local vs cloud
   */
  async initialize() {
    // Auto-detect if not explicitly set
    if (!this.apiUrl) {
      this.apiUrl = await this.autoDetectEndpoint();
    }

    this.isLocal = this.apiUrl.includes('localhost') || this.apiUrl.includes('127.0.0.1');

    console.error(this.isLocal
      ? '🏠 Using ZeroLocal (localhost:8000)'
      : '☁️  Using ZeroDB Cloud (api.ainative.studio)'
    );

    // Authenticate
    await this.authenticate();

    // Validate auth by calling /api/v1/auth/me
    await this.validateAuth();

    return this;
  }

  /**
   * Auto-detect ZeroLocal vs Cloud
   */
  async autoDetectEndpoint() {
    const localUrl = 'http://localhost:8000';
    const cloudUrl = 'https://api.ainative.studio';

    // Try local first
    try {
      const response = await axios.get(`${localUrl}/health`, { timeout: 2000 });
      if (response.status === 200) {
        console.error('✅ ZeroLocal detected');
        return localUrl;
      }
    } catch (error) {
      // Local not available, fall back to cloud
    }

    console.error('⚠️  ZeroLocal not available, using cloud');
    return cloudUrl;
  }

  /**
   * Authenticate and get JWT token
   */
  async authenticate() {
    // If API key is provided, use it directly (no login needed)
    if (this.apiKey) {
      this.token = this.apiKey;
      this.tokenExpiry = null;  // API keys don't expire
      console.error('✅ Using API key authentication');
      return;
    }

    if (!this.username || !this.password) {
      throw new Error('Either ZERODB_API_KEY or (ZERODB_USERNAME and ZERODB_PASSWORD) are required');
    }

    try {
      const response = await axios.post(`${this.apiUrl}/api/v1/auth/login`, {  // Fixed: Added /api prefix
        email: this.username,  // API expects 'email' not 'username'
        password: this.password
      });

      this.token = response.data.access_token;

      // JWT tokens typically expire in 1 hour, refresh after 50 minutes
      this.tokenExpiry = Date.now() + (50 * 60 * 1000);

      console.error('✅ Authenticated successfully with username/password');
    } catch (error) {
      const authDetail = error.response?.data?.detail;
      const authDetailStr = typeof authDetail === 'object' ? JSON.stringify(authDetail) : (authDetail || error.message);
      throw new Error(`Authentication failed: ${authDetailStr}`);
    }
  }

  /**
   * Validate authentication by making a lightweight authenticated request.
   * Uses /api/v1/auth/me for JWT, or a test memory search for API keys
   * (since /auth/me requires JWT). Logs a clear error if credentials are
   * invalid but does not throw.
   */
  async validateAuth() {
    try {
      const headers = { 'Content-Type': 'application/json' };
      let validateUrl;

      if (this.apiKey) {
        headers['X-API-Key'] = this.token;
        // /auth/me doesn't accept API keys — use a lightweight memory search instead
        validateUrl = `${this.apiUrl}/api/v1/public/memory/v2/recall`;
        const response = await axios.post(validateUrl, { query: '__auth_check__', limit: 1 }, { headers, timeout: 10000 });
        if (response.status === 200) {
          console.error('✅ Auth validated - API key is working');
          this.authValid = true;
        }
      } else {
        headers['Authorization'] = `Bearer ${this.token}`;
        validateUrl = `${this.apiUrl}/api/v1/auth/me`;
        const response = await axios.get(validateUrl, { headers, timeout: 10000 });
        if (response.status === 200) {
          console.error('✅ Auth validated - credentials are working');
          this.authValid = true;
        }
      }
    } catch (error) {
      this.authValid = false;
      const status = error.response?.status;
      const rawDetail = error.response?.data?.detail;
      const detail = typeof rawDetail === 'object' ? JSON.stringify(rawDetail) : (rawDetail || error.message);
      console.error('');
      console.error('===========================================');
      console.error('  AUTH FAILED');
      console.error('===========================================');
      console.error(`  Status: ${status || 'N/A'}`);
      console.error(`  Detail: ${detail}`);
      console.error('');
      console.error('  Your ZERODB credentials are invalid.');
      console.error('  Check ZERODB_API_KEY or ZERODB_USERNAME/ZERODB_PASSWORD env vars.');
      console.error('');
      console.error('  Common cause: shell env vars (~/.zshrc, ~/.bashrc)');
      console.error('  may override your MCP config. API key auth');
      console.error('  (ZERODB_API_KEY) is recommended over username/password.');
      console.error('===========================================');
      console.error('');
    }
  }

  /**
   * Ensure token is valid, refresh if needed
   */
  async ensureAuthenticated() {
    // API keys don't expire (tokenExpiry is null)
    if (!this.token || (this.tokenExpiry && Date.now() >= this.tokenExpiry)) {
      await this.authenticate();
    }
  }

  /**
   * Make authenticated API request
   */
  async request(method, path, data = null) {
    await this.ensureAuthenticated();

    const headers = {
      'Content-Type': 'application/json'
    };

    // Use X-API-Key header if API key, otherwise Bearer token
    if (this.apiKey) {
      headers['X-API-Key'] = this.token;
    } else {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Include project ID if configured
    if (this.projectId) {
      headers['X-Project-ID'] = this.projectId;
    }

    const config = {
      method,
      url: `${this.apiUrl}${path}`,
      headers
    };

    if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      // Auto-retry on 401 with fresh token (token may have expired)
      if (error.response?.status === 401 && !config._retried) {
        console.error('⚠️  Token expired, re-authenticating...');
        this.token = null;
        this.tokenExpiry = null;
        await this.authenticate();

        // Update headers with new token
        if (this.apiKey) {
          config.headers['X-API-Key'] = this.token;
        } else {
          config.headers['Authorization'] = `Bearer ${this.token}`;
        }
        config._retried = true;

        const retryResponse = await axios(config);
        return retryResponse.data;
      }
      const detail = error.response?.data?.detail;
      const detailStr = typeof detail === 'object' ? JSON.stringify(detail) : (detail || error.message);
      throw new Error(`API request failed: ${detailStr}`);
    }
  }

  /**
   * Store memory with automatic embedding
   */
  async storeMemory({ content, role = 'user', sessionId, metadata = {}, importance = null }) {
    const path = `/api/v1/public/memory/v2/remember`;
    const namespace = sessionId ? `session:${sessionId}` : 'global';

    return await this.request('POST', path, {
      content,
      session_id: sessionId,
      namespace,
      metadata: {
        ...metadata,
        role,
        importance,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Search memory semantically
   */
  async searchMemory({ query, limit = 10, sessionId = null, scope = 'session' }) {
    const path = `/api/v1/public/memory/v2/recall`;
    const namespace = sessionId ? `session:${sessionId}` : 'global';

    const results = await this.request('POST', path, {
      query,
      limit,
      session_id: sessionId,
      namespace,
      allow_cross_namespace: !sessionId
    });

    return results.results || results.memories || [];
  }

  /**
   * Get context window for session
   * Client-side implementation since API doesn't provide context endpoint
   */
  async getContext({ sessionId, maxTokens = 8192 }) {
    // Fetch recent memories for this session via recall
    const path = `/api/v1/public/memory/v2/recall`;
    const allMemories = await this.request('POST', path, {
      query: sessionId,
      limit: 50,
      session_id: sessionId,
      namespace: `session:${sessionId}`
    });

    // Extract results from v2 response
    const sessionMemories = allMemories.results || allMemories.memories || (Array.isArray(allMemories) ? allMemories : []);

    // Simple token estimation (4 chars ≈ 1 token)
    let totalTokens = 0;
    const context = [];

    for (const memory of sessionMemories) {
      const memoryTokens = Math.ceil((memory.content?.length || 0) / 4);
      if (totalTokens + memoryTokens <= maxTokens) {
        context.push(memory);
        totalTokens += memoryTokens;
      } else {
        break;
      }
    }

    return {
      session_id: sessionId,
      memories: context,
      total_tokens: totalTokens,
      max_tokens: maxTokens,
      memory_count: context.length
    };
  }

  /**
   * Generate embeddings
   */
  async embedText(text, model = 'BAAI/bge-small-en-v1.5') {
    const path = `/api/v1/projects/${this.projectId}/embeddings/generate`;

    const result = await this.request('POST', path, {
      texts: [text],
      model,
      normalize: true
    });

    return {
      embedding: result.embeddings?.[0] || [],
      model: result.model,
      dimensions: result.dimensions
    };
  }

  /**
   * Upsert vector with metadata
   */
  async upsertVector({ id, vector, metadata }) {
    const path = `/api/v1/projects/${this.projectId}/database/vectors`;

    return await this.request('POST', path, {
      vectors: [{
        id,
        vector,
        metadata
      }]
    });
  }

  /**
   * Search vectors by similarity
   */
  async searchVectors({ vector, text, limit = 10, filter = null, model = 'BAAI/bge-small-en-v1.5' }) {
    // If text is provided, use semantic search (embeds + searches in one call)
    if (text) {
      const path = `/api/v1/projects/${this.projectId}/embeddings/search`;
      return await this.request('POST', path, {
        query: text,
        limit,
        model,
        filter_metadata: filter
      });
    }

    // If raw vector is provided, use direct vector search
    const path = `/api/v1/projects/${this.projectId}/database/vectors/search`;
    return await this.request('POST', path, {
      vector,
      limit,
      filter
    });
  }

  /**
   * Clear session memory
   * Client-side implementation - fetches and deletes memories by session
   */
  async clearSession(sessionId, keepImportant = false) {
    // Fetch all memories
    const path = `/api/v1/public/memory/`;
    const allMemories = await this.request('GET', path);

    // Filter by session
    const sessionMemories = (Array.isArray(allMemories) ? allMemories : allMemories.memories || [])
      .filter(memory => memory.metadata?.session_id === sessionId);

    // Optionally keep important memories
    const toDelete = keepImportant
      ? sessionMemories.filter(m => !m.tags?.includes('important') && !m.tags?.includes('permanent'))
      : sessionMemories;

    // Delete each memory
    let deletedCount = 0;
    for (const memory of toDelete) {
      try {
        await this.request('DELETE', `/api/v1/public/memory/${memory.id}`);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete memory ${memory.id}:`, error.message);
      }
    }

    return {
      session_id: sessionId,
      deleted_count: deletedCount,
      total_count: sessionMemories.length
    };
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats() {
    const path = `/api/v1/projects/${this.projectId}/database/memory/stats`;

    return await this.request('GET', path);
  }

  /**
   * Synthesize context from memory using the context synthesis endpoint (Issue #2631)
   * Wraps POST /api/v1/public/memory/v2/context
   */
  async synthesizeContext({ query, agentId, synthesisStyle = 'narrative', maxTokens = 1000, topK = 10 }) {
    const path = `/api/v1/public/memory/v2/context`;
    return await this.request('POST', path, {
      query,
      agent_id: agentId,
      synthesis_style: synthesisStyle,
      max_tokens: maxTokens,
      top_k: topK,
    });
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.apiUrl}/health`);
      return response.data;
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }
}
