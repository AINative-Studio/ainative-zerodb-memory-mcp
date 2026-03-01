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
    if (!this.username || !this.password) {
      throw new Error('ZERODB_USERNAME and ZERODB_PASSWORD are required');
    }

    try {
      const response = await axios.post(`${this.apiUrl}/v1/auth/login`, {
        username: this.username,
        password: this.password
      });

      this.token = response.data.access_token;

      // JWT tokens typically expire in 1 hour, refresh after 50 minutes
      this.tokenExpiry = Date.now() + (50 * 60 * 1000);

      console.error('✅ Authenticated successfully');
    } catch (error) {
      throw new Error(`Authentication failed: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Ensure token is valid, refresh if needed
   */
  async ensureAuthenticated() {
    if (!this.token || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  /**
   * Make authenticated API request
   */
  async request(method, path, data = null) {
    await this.ensureAuthenticated();

    const config = {
      method,
      url: `${this.apiUrl}${path}`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      throw new Error(`API request failed: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Store memory with automatic embedding
   */
  async storeMemory({ content, role = 'user', sessionId, metadata = {}, importance = null }) {
    const path = `/v1/projects/${this.projectId}/database/memory`;

    return await this.request('POST', path, {
      content,
      role,
      session_id: sessionId,
      metadata: {
        ...metadata,
        importance,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Search memory semantically
   */
  async searchMemory({ query, limit = 10, sessionId = null, scope = 'session' }) {
    const path = `/v1/projects/${this.projectId}/database/memory/search`;

    return await this.request('POST', path, {
      query,
      limit,
      session_id: sessionId,
      scope
    });
  }

  /**
   * Get context window for session
   */
  async getContext({ sessionId, maxTokens = 8192 }) {
    const path = `/v1/projects/${this.projectId}/database/memory/context/${sessionId}`;

    return await this.request('GET', `${path}?max_tokens=${maxTokens}`);
  }

  /**
   * Generate embeddings
   */
  async embedText(text) {
    const path = `/v1/projects/${this.projectId}/database/vectors/embed`;

    return await this.request('POST', path, {
      text,
      model: 'BAAI/bge-small-en-v1.5'
    });
  }

  /**
   * Upsert vector with metadata
   */
  async upsertVector({ id, vector, metadata }) {
    const path = `/v1/projects/${this.projectId}/database/vectors`;

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
  async searchVectors({ vector, limit = 10, filter = null }) {
    const path = `/v1/projects/${this.projectId}/database/vectors/search`;

    return await this.request('POST', path, {
      vector,
      limit,
      filter
    });
  }

  /**
   * Clear session memory
   */
  async clearSession(sessionId) {
    const path = `/v1/projects/${this.projectId}/database/memory/session/${sessionId}`;

    return await this.request('DELETE', path);
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats() {
    const path = `/v1/projects/${this.projectId}/database/memory/stats`;

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
