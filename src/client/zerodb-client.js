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
      throw new Error(`Authentication failed: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Validate authentication by calling /api/v1/auth/me
   * Logs a clear error if credentials are invalid but does not throw
   */
  async validateAuth() {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['X-API-Key'] = this.token;
      } else {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await axios.get(`${this.apiUrl}/api/v1/auth/me`, { headers, timeout: 10000 });
      if (response.status === 200) {
        console.error('✅ Auth validated - credentials are working');
        this.authValid = true;
      }
    } catch (error) {
      this.authValid = false;
      const status = error.response?.status;
      const detail = error.response?.data?.detail || error.message;
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
      throw new Error(`API request failed: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Store memory with automatic embedding
   */
  async storeMemory({ content, role = 'user', sessionId, metadata = {}, importance = null }) {
    const path = `/api/v1/public/memory/`;

    // Map curriculum fields to API fields
    const priorityMap = {
      'system': 'high',
      'user': 'medium',
      'assistant': 'low'
    };

    // If importance provided, use it to determine priority
    let priority = 'medium';
    if (importance !== null) {
      if (importance >= 0.8) priority = 'critical';
      else if (importance >= 0.6) priority = 'high';
      else if (importance >= 0.4) priority = 'medium';
      else priority = 'low';
    } else {
      priority = priorityMap[role] || 'medium';
    }

    return await this.request('POST', path, {
      title: `${role} memory`,
      content,
      type: 'conversation',  // API uses 'type' not 'role'
      priority,               // API uses 'priority' not 'importance'
      tags: [],
      metadata: {
        ...metadata,
        role,                 // Store original role in metadata
        session_id: sessionId, // Store session_id in metadata
        importance,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Search memory semantically
   */
  async searchMemory({ query, limit = 10, sessionId = null, scope = 'session' }) {
    const path = `/api/v1/public/memory/search`;

    // API doesn't support session_id or scope, so we'll fetch more results
    // and filter client-side
    const fetchLimit = sessionId ? limit * 3 : limit;

    const results = await this.request('POST', path, {
      query,
      limit: fetchLimit
    });

    // Client-side filtering by session if needed
    let filteredResults = Array.isArray(results) ? results : (results.memories || []);

    if (sessionId && scope === 'session') {
      filteredResults = filteredResults.filter(memory =>
        memory.metadata?.session_id === sessionId
      );
    }

    // Return up to requested limit
    return filteredResults.slice(0, limit);
  }

  /**
   * Get context window for session
   * Client-side implementation since API doesn't provide context endpoint
   */
  async getContext({ sessionId, maxTokens = 8192 }) {
    // Fetch all memories (API returns them ordered by recency)
    const path = `/api/v1/public/memory/`;
    const allMemories = await this.request('GET', path);

    // Filter by session
    const sessionMemories = (Array.isArray(allMemories) ? allMemories : allMemories.memories || [])
      .filter(memory => memory.metadata?.session_id === sessionId);

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
