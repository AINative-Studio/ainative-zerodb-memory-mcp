/**
 * Memory Manager - Advanced context window and memory management
 *
 * Features:
 * - Smart context window management
 * - Memory pruning (relevance, recency, hybrid)
 * - Memory importance scoring
 * - Memory decay
 * - Automatic summarization
 * - Cross-session memory
 */

export class MemoryManager {
  constructor(client, config = {}) {
    this.client = client;

    // Context window configuration
    this.maxTokens = config.maxTokens || parseInt(process.env.CONTEXT_WINDOW) || 8192;
    this.pruneStrategy = config.pruneStrategy || 'hybrid'; // 'relevance', 'recency', 'hybrid'

    // Memory configuration
    this.keepRecent = config.keepRecent || 5; // Always keep N recent memories
    this.keepImportant = config.keepImportant !== false; // Keep flagged important memories

    // Summarization configuration
    this.summarizeEnabled = config.summarize?.enabled !== false;
    this.summarizeAfterMessages = config.summarize?.afterMessages || 20;
    this.summaryModel = config.summarize?.model || 'claude-3-haiku-20240307';
    this.keepOriginals = config.summarize?.keepOriginals || false;

    // Decay configuration
    this.decayEnabled = config.decay?.enabled || false;
    this.decayHalfLife = config.decay?.halfLife || 30; // Days
    this.preserveTags = config.decay?.preserveTags || ['important', 'permanent'];

    // Auto-embedding
    this.autoEmbed = config.autoEmbed !== false;
    this.embeddingModel = config.embeddingModel || 'BAAI/bge-small-en-v1.5';
  }

  /**
   * Calculate memory importance score (0.0 to 1.0)
   * Based on:
   * - Explicit tags
   * - Content analysis
   * - Role (system > assistant > user)
   * - Recency
   */
  calculateImportance(memory) {
    let score = 0.5; // Base score

    // Role weights
    const roleWeights = {
      system: 0.9,
      assistant: 0.6,
      user: 0.5
    };
    score = roleWeights[memory.role] || 0.5;

    // Tag-based importance
    if (memory.metadata?.tags) {
      const importantTags = ['critical', 'important', 'permanent', 'health', 'security'];
      const hasImportantTag = memory.metadata.tags.some(tag =>
        importantTags.includes(tag.toLowerCase())
      );
      if (hasImportantTag) {
        score = Math.min(1.0, score + 0.3);
      }
    }

    // Explicit importance override
    if (memory.metadata?.importance !== undefined) {
      score = memory.metadata.importance;
    }

    // Content length (longer = potentially more important)
    const contentLength = memory.content.length;
    if (contentLength > 500) {
      score = Math.min(1.0, score + 0.1);
    }

    // Recency boost (more recent = slight boost)
    if (memory.metadata?.timestamp) {
      const ageHours = (Date.now() - new Date(memory.metadata.timestamp).getTime()) / (1000 * 60 * 60);
      if (ageHours < 1) {
        score = Math.min(1.0, score + 0.1);
      }
    }

    return Math.max(0.0, Math.min(1.0, score));
  }

  /**
   * Apply memory decay based on age
   */
  applyDecay(memory) {
    if (!this.decayEnabled) {
      return memory;
    }

    // Check if memory has preserve tags
    if (memory.metadata?.tags) {
      const hasPreserveTag = memory.metadata.tags.some(tag =>
        this.preserveTags.includes(tag)
      );
      if (hasPreserveTag) {
        return memory; // Don't decay preserved memories
      }
    }

    if (!memory.metadata?.timestamp) {
      return memory;
    }

    // Calculate age in days
    const ageDays = (Date.now() - new Date(memory.metadata.timestamp).getTime()) / (1000 * 60 * 60 * 24);

    // Apply exponential decay: importance = importance * 0.5^(age/halfLife)
    const decayFactor = Math.pow(0.5, ageDays / this.decayHalfLife);
    const currentImportance = memory.metadata.importance || 0.5;
    const newImportance = currentImportance * decayFactor;

    return {
      ...memory,
      metadata: {
        ...memory.metadata,
        importance: newImportance,
        decayed: true,
        originalImportance: currentImportance
      }
    };
  }

  /**
   * Prune memories based on strategy
   */
  async pruneMemories(memories, targetTokens) {
    // Apply decay first
    const decayedMemories = memories.map(m => this.applyDecay(m));

    // Calculate importance scores
    const scoredMemories = decayedMemories.map(memory => ({
      ...memory,
      _score: this.calculateImportance(memory),
      _tokens: this.estimateTokens(memory.content)
    }));

    // Always keep recent and important memories
    // Sort by timestamp to get truly recent memories
    const sortedByTime = [...scoredMemories].sort((a, b) => {
      const aTime = new Date(a.metadata?.timestamp || 0).getTime();
      const bTime = new Date(b.metadata?.timestamp || 0).getTime();
      return bTime - aTime; // Most recent first
    });
    const recentMemories = sortedByTime.slice(0, this.keepRecent);

    const importantMemories = this.keepImportant
      ? scoredMemories.filter(m => m._score >= 0.8)
      : [];

    const mustKeep = new Set([
      ...recentMemories.map(m => m.id),
      ...importantMemories.map(m => m.id)
    ]);

    // Sort by strategy
    let sorted;
    switch (this.pruneStrategy) {
      case 'relevance':
        // Keep highest scored memories
        sorted = [...scoredMemories].sort((a, b) => b._score - a._score);
        break;

      case 'recency':
        // Keep most recent memories
        sorted = [...scoredMemories].sort((a, b) => {
          const aTime = new Date(a.metadata?.timestamp || 0).getTime();
          const bTime = new Date(b.metadata?.timestamp || 0).getTime();
          return bTime - aTime;
        });
        break;

      case 'hybrid':
      default:
        // Combine recency and relevance
        sorted = [...scoredMemories].sort((a, b) => {
          const aTime = new Date(a.metadata?.timestamp || 0).getTime();
          const bTime = new Date(b.metadata?.timestamp || 0).getTime();
          const recencyScore = (time) => Math.min(1.0, time / Date.now());

          const aHybrid = (a._score * 0.7) + (recencyScore(aTime) * 0.3);
          const bHybrid = (b._score * 0.7) + (recencyScore(bTime) * 0.3);

          return bHybrid - aHybrid;
        });
        break;
    }

    // Select memories to keep within token budget
    const kept = [];
    let totalTokens = 0;

    // First pass: add must-keep memories that fit in budget
    for (const memory of sorted) {
      if (mustKeep.has(memory.id) && totalTokens + memory._tokens <= targetTokens) {
        kept.push(memory);
        totalTokens += memory._tokens;
      }
    }

    // Second pass: add other memories if budget allows
    for (const memory of sorted) {
      if (!mustKeep.has(memory.id) && totalTokens + memory._tokens <= targetTokens) {
        kept.push(memory);
        totalTokens += memory._tokens;
      }
    }

    // Sort kept memories chronologically
    kept.sort((a, b) => {
      const aTime = new Date(a.metadata?.timestamp || 0).getTime();
      const bTime = new Date(b.metadata?.timestamp || 0).getTime();
      return aTime - bTime;
    });

    return kept;
  }

  /**
   * Estimate token count (rough approximation: ~4 chars = 1 token)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Store memory with automatic importance scoring and embedding
   */
  async storeMemory({ content, role = 'user', sessionId, metadata = {}, tags = [] }) {
    // Calculate importance score
    const tempMemory = {
      content,
      role,
      metadata: { ...metadata, tags }
    };
    const importance = this.calculateImportance(tempMemory);

    // Generate embedding if auto-embed enabled
    let embedding;
    if (this.autoEmbed) {
      try {
        const embedResult = await this.client.embedText(content);
        embedding = embedResult.embedding || embedResult.vector;
      } catch (error) {
        console.error('Warning: Auto-embedding failed:', error.message);
      }
    }

    // Build metadata object
    const fullMetadata = {
      ...metadata,
      importance,
      tags,
      timestamp: new Date().toISOString()
    };

    // Only add embedding if it was generated
    if (embedding !== undefined) {
      fullMetadata.embedding = embedding;
    }

    // Store with calculated importance
    return await this.client.storeMemory({
      content,
      role,
      sessionId,
      metadata: fullMetadata
    });
  }

  /**
   * Get context window with smart management
   */
  async getContext({ sessionId, maxTokens = null }) {
    const targetTokens = maxTokens || this.maxTokens;

    // Get all memories for session
    const response = await this.client.getContext({ sessionId, maxTokens: 999999 });
    const allMemories = response.memories || [];

    if (allMemories.length === 0) {
      return { memories: [], totalTokens: 0, pruned: false };
    }

    // Calculate total tokens
    const totalTokens = allMemories.reduce((sum, m) =>
      sum + this.estimateTokens(m.content), 0
    );

    // If within budget, return as-is
    if (totalTokens <= targetTokens) {
      return {
        memories: allMemories,
        totalTokens,
        pruned: false
      };
    }

    // Need to prune
    const prunedMemories = await this.pruneMemories(allMemories, targetTokens);
    const prunedTokens = prunedMemories.reduce((sum, m) =>
      sum + this.estimateTokens(m.content), 0
    );

    return {
      memories: prunedMemories,
      totalTokens: prunedTokens,
      pruned: true,
      originalCount: allMemories.length,
      prunedCount: prunedMemories.length
    };
  }

  /**
   * Search memory with cross-session support
   */
  async searchMemory({ query, limit = 10, sessionId = null, userId = null, scope = 'session' }) {
    // If userId provided and scope is 'agent', search across all sessions
    if (scope === 'agent' && userId) {
      const results = await this.client.searchMemory({
        query,
        limit: limit * 2, // Get more to filter
        scope: 'agent'
      });

      // Filter by userId if specified
      const filtered = userId
        ? results.filter(r => r.metadata?.userId === userId)
        : results;

      return filtered.slice(0, limit);
    }

    // Standard session-scoped search
    return await this.client.searchMemory({
      query,
      limit,
      sessionId,
      scope
    });
  }

  /**
   * Summarize old memories (placeholder - requires LLM integration)
   */
  async summarizeOldMemories({ sessionId, threshold = null }) {
    if (!this.summarizeEnabled) {
      return null;
    }

    const messageThreshold = threshold || this.summarizeAfterMessages;

    // Get all memories
    const response = await this.client.getContext({ sessionId, maxTokens: 999999 });
    const allMemories = response.memories || [];

    if (allMemories.length < messageThreshold) {
      return null; // Not enough messages to summarize
    }

    // Split into old (to summarize) and recent (to keep)
    const toSummarize = allMemories.slice(0, -this.keepRecent);
    const toKeep = allMemories.slice(-this.keepRecent);

    // NOTE: Actual summarization would require LLM API call
    // For now, create a placeholder summary
    const summary = {
      content: `[Summary of ${toSummarize.length} previous messages]`,
      role: 'system',
      metadata: {
        type: 'summary',
        summarizedCount: toSummarize.length,
        summarizedIds: toSummarize.map(m => m.id),
        timestamp: new Date().toISOString()
      }
    };

    // Store summary
    await this.storeMemory({
      ...summary,
      sessionId,
      tags: ['summary', 'important']
    });

    // Optionally delete original memories
    if (!this.keepOriginals) {
      // Would need batch delete endpoint
      console.error(`Would delete ${toSummarize.length} summarized memories`);
    }

    return {
      summary,
      summarizedCount: toSummarize.length,
      keptCount: toKeep.length
    };
  }

  /**
   * Clear session with confirmation
   */
  async clearSession(sessionId) {
    return await this.client.clearSession(sessionId);
  }
}
