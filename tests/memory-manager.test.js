/**
 * Memory Manager Tests
 *
 * Tests for all advanced memory management features:
 * - Importance scoring
 * - Memory decay
 * - Pruning strategies
 * - Context window management
 * - Auto-embedding
 * - Cross-session memory
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MemoryManager } from '../src/utils/memory-manager.js';

// Mock ZeroDB client
class MockClient {
  constructor() {
    this.memories = [];
    this.nextId = 1;
  }

  async storeMemory({ content, role, sessionId, metadata }) {
    const memory = {
      id: `mem_${this.nextId++}`,
      content,
      role,
      session_id: sessionId,
      metadata: {
        ...metadata,
        timestamp: metadata.timestamp || new Date().toISOString()
      }
    };
    this.memories.push(memory);
    return memory;
  }

  async searchMemory({ query, limit, sessionId, scope }) {
    let filtered = this.memories;

    if (scope === 'session' && sessionId) {
      filtered = filtered.filter(m => m.session_id === sessionId);
    }

    // Simple mock search - return all matching
    return filtered.slice(0, limit);
  }

  async getContext({ sessionId, maxTokens }) {
    const filtered = this.memories.filter(m => m.session_id === sessionId);
    return { memories: filtered };
  }

  async embedText(text) {
    // Mock embedding - return fake vector
    return {
      embedding: Array(384).fill(0).map(() => Math.random())
    };
  }

  async clearSession(sessionId) {
    this.memories = this.memories.filter(m => m.session_id !== sessionId);
    return { success: true };
  }

  // Helper: reset state
  reset() {
    this.memories = [];
    this.nextId = 1;
  }
}

describe('MemoryManager', () => {
  let client;
  let manager;

  before(() => {
    client = new MockClient();
    manager = new MemoryManager(client, {
      maxTokens: 1000,
      pruneStrategy: 'hybrid',
      keepRecent: 3,
      autoEmbed: true
    });
  });

  after(() => {
    client.reset();
  });

  describe('Importance Scoring', () => {
    it('should score system messages higher than user messages', () => {
      const systemMem = {
        content: 'System instruction',
        role: 'system',
        metadata: {}
      };
      const userMem = {
        content: 'User message',
        role: 'user',
        metadata: {}
      };

      const systemScore = manager.calculateImportance(systemMem);
      const userScore = manager.calculateImportance(userMem);

      assert.ok(systemScore > userScore, 'System messages should score higher');
      assert.strictEqual(systemScore, 0.9);
      assert.strictEqual(userScore, 0.5);
    });

    it('should boost importance for tagged memories', () => {
      const taggedMem = {
        content: 'Important fact',
        role: 'user',
        metadata: {
          tags: ['important', 'critical']
        }
      };
      const normalMem = {
        content: 'Normal fact',
        role: 'user',
        metadata: {}
      };

      const taggedScore = manager.calculateImportance(taggedMem);
      const normalScore = manager.calculateImportance(normalMem);

      assert.ok(taggedScore > normalScore, 'Tagged memories should score higher');
      assert.ok(taggedScore >= 0.8, 'Tagged score should be at least 0.8');
    });

    it('should respect explicit importance override', () => {
      const explicitMem = {
        content: 'Explicit importance',
        role: 'user',
        metadata: {
          importance: 0.95
        }
      };

      const score = manager.calculateImportance(explicitMem);
      assert.strictEqual(score, 0.95, 'Should use explicit importance');
    });

    it('should boost longer content', () => {
      const longMem = {
        content: 'x'.repeat(600),
        role: 'user',
        metadata: {}
      };
      const shortMem = {
        content: 'short',
        role: 'user',
        metadata: {}
      };

      const longScore = manager.calculateImportance(longMem);
      const shortScore = manager.calculateImportance(shortMem);

      assert.ok(longScore > shortScore, 'Longer content should score higher');
    });

    it('should boost recent memories', () => {
      const recentMem = {
        content: 'Recent memory',
        role: 'user',
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
      const oldMem = {
        content: 'Old memory',
        role: 'user',
        metadata: {
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }
      };

      const recentScore = manager.calculateImportance(recentMem);
      const oldScore = manager.calculateImportance(oldMem);

      assert.ok(recentScore > oldScore, 'Recent memories should score higher');
    });
  });

  describe('Memory Decay', () => {
    it('should not decay when disabled', () => {
      const managerNoDecay = new MemoryManager(client, {
        decay: { enabled: false }
      });

      const memory = {
        content: 'Test',
        role: 'user',
        metadata: {
          importance: 0.8,
          timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      };

      const decayed = managerNoDecay.applyDecay(memory);
      assert.strictEqual(decayed.metadata.importance, 0.8, 'Should not decay');
    });

    it('should apply decay based on age', () => {
      const managerWithDecay = new MemoryManager(client, {
        decay: {
          enabled: true,
          halfLife: 30
        }
      });

      const memory = {
        content: 'Test',
        role: 'user',
        metadata: {
          importance: 0.8,
          timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      };

      const decayed = managerWithDecay.applyDecay(memory);
      assert.ok(decayed.metadata.importance < 0.8, 'Should decay');
      assert.ok(decayed.metadata.importance > 0.3, 'Should be ~0.4 after 30 days');
      assert.ok(decayed.metadata.decayed, 'Should be marked as decayed');
      assert.strictEqual(decayed.metadata.originalImportance, 0.8);
    });

    it('should preserve memories with preserve tags', () => {
      const managerWithDecay = new MemoryManager(client, {
        decay: {
          enabled: true,
          halfLife: 30,
          preserveTags: ['important', 'permanent']
        }
      });

      const memory = {
        content: 'Test',
        role: 'user',
        metadata: {
          importance: 0.8,
          timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
          tags: ['important']
        }
      };

      const decayed = managerWithDecay.applyDecay(memory);
      assert.strictEqual(decayed.metadata.importance, 0.8, 'Should not decay preserved tags');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens correctly', () => {
      const text = 'This is a test string';
      const tokens = manager.estimateTokens(text);

      // ~4 chars = 1 token
      const expected = Math.ceil(text.length / 4);
      assert.strictEqual(tokens, expected);
    });

    it('should handle empty strings', () => {
      const tokens = manager.estimateTokens('');
      assert.strictEqual(tokens, 0);
    });
  });

  describe('Memory Pruning', () => {
    it('should prune memories to fit token budget (relevance strategy)', async () => {
      const managerRelevance = new MemoryManager(client, {
        pruneStrategy: 'relevance',
        keepRecent: 2,
        keepImportant: false  // Disable importance-based keeping for this test
      });

      const memories = [
        {
          id: 1,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: { importance: 0.9, timestamp: new Date(Date.now() - 1000).toISOString() }
        },
        {
          id: 2,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: { importance: 0.5, timestamp: new Date(Date.now() - 2000).toISOString() }
        },
        {
          id: 3,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: { importance: 0.7, timestamp: new Date(Date.now() - 3000).toISOString() }
        }
      ];

      const pruned = await managerRelevance.pruneMemories(memories, 50); // Tight budget

      // Should keep highest importance + recent
      assert.ok(pruned.length < memories.length, 'Should prune some memories');
      assert.ok(pruned.some(m => m.id === 1), 'Should keep highest importance');
    });

    it('should keep recent memories regardless of importance', async () => {
      const managerRecent = new MemoryManager(client, {
        pruneStrategy: 'recency',
        keepRecent: 2
      });

      const memories = [
        {
          id: 1,
          content: 'old important',
          role: 'system',
          metadata: { importance: 0.9, timestamp: new Date(Date.now() - 10000).toISOString() }
        },
        {
          id: 2,
          content: 'recent low',
          role: 'user',
          metadata: { importance: 0.3, timestamp: new Date(Date.now() - 1000).toISOString() }
        },
        {
          id: 3,
          content: 'most recent',
          role: 'user',
          metadata: { importance: 0.4, timestamp: new Date().toISOString() }
        }
      ];

      const pruned = await managerRecent.pruneMemories(memories, 50);

      // Should keep most recent 2
      assert.ok(pruned.some(m => m.id === 2), 'Should keep recent memory');
      assert.ok(pruned.some(m => m.id === 3), 'Should keep most recent memory');
    });

    it('should always keep important tagged memories', async () => {
      const memories = [
        {
          id: 1,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: {
            importance: 0.85,
            timestamp: new Date(Date.now() - 10000).toISOString(),
            tags: ['important']
          }
        },
        {
          id: 2,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: { importance: 0.5, timestamp: new Date().toISOString() }
        }
      ];

      const pruned = await manager.pruneMemories(memories, 50);

      assert.ok(pruned.some(m => m.id === 1), 'Should keep important tagged memory');
    });
  });

  describe('Store Memory', () => {
    it('should store memory with auto-calculated importance', async () => {
      const result = await manager.storeMemory({
        content: 'User prefers technical explanations',
        role: 'system',
        sessionId: 'test-session',
        tags: ['preference']
      });

      assert.ok(result.id, 'Should return memory ID');
      assert.ok(result.metadata.importance > 0, 'Should have importance score');
      assert.ok(Array.isArray(result.metadata.embedding), 'Should have embedding');
    });

    it('should respect explicit tags', async () => {
      const result = await manager.storeMemory({
        content: 'Critical information',
        role: 'user',
        sessionId: 'test-session',
        tags: ['critical', 'important']
      });

      assert.deepStrictEqual(result.metadata.tags, ['critical', 'important']);
    });

    it('should auto-embed when enabled', async () => {
      const managerAutoEmbed = new MemoryManager(client, {
        autoEmbed: true
      });

      const result = await managerAutoEmbed.storeMemory({
        content: 'Test content',
        role: 'user',
        sessionId: 'test-session'
      });

      assert.ok(result.metadata.embedding, 'Should have embedding');
      assert.ok(Array.isArray(result.metadata.embedding), 'Embedding should be array');
    });

    it('should not embed when disabled', async () => {
      const managerNoEmbed = new MemoryManager(client, {
        autoEmbed: false
      });

      const result = await managerNoEmbed.storeMemory({
        content: 'Test content',
        role: 'user',
        sessionId: 'test-session'
      });

      assert.strictEqual(result.metadata.embedding, undefined, 'Should not have embedding');
    });
  });

  describe('Get Context', () => {
    before(() => {
      client.reset();
    });

    it('should return all memories when within budget', async () => {
      // Add some test memories
      await manager.storeMemory({
        content: 'Memory 1',
        role: 'user',
        sessionId: 'ctx-session'
      });
      await manager.storeMemory({
        content: 'Memory 2',
        role: 'user',
        sessionId: 'ctx-session'
      });

      const context = await manager.getContext({
        sessionId: 'ctx-session',
        maxTokens: 10000
      });

      assert.strictEqual(context.memories.length, 2);
      assert.strictEqual(context.pruned, false);
    });

    it('should prune when exceeding budget', async () => {
      client.reset();

      // Add many memories
      for (let i = 0; i < 20; i++) {
        await manager.storeMemory({
          content: 'x'.repeat(100),
          role: 'user',
          sessionId: 'prune-session',
          tags: i < 3 ? ['important'] : []
        });
      }

      const context = await manager.getContext({
        sessionId: 'prune-session',
        maxTokens: 100
      });

      assert.ok(context.pruned, 'Should be pruned');
      assert.ok(context.memories.length < 20, 'Should have fewer memories');
      assert.strictEqual(context.originalCount, 20);
    });
  });

  describe('Search Memory', () => {
    before(async () => {
      client.reset();

      // Add test memories
      await manager.storeMemory({
        content: 'User prefers dark mode',
        role: 'user',
        sessionId: 'search-session',
        tags: ['preference'],
        metadata: { userId: 'user-123' }
      });
      await manager.storeMemory({
        content: 'User allergic to peanuts',
        role: 'user',
        sessionId: 'search-session',
        tags: ['health', 'critical'],
        metadata: { userId: 'user-123' }
      });
    });

    it('should search within session scope', async () => {
      const results = await manager.searchMemory({
        query: 'preferences',
        limit: 10,
        sessionId: 'search-session',
        scope: 'session'
      });

      assert.ok(results.length > 0, 'Should find results');
    });

    it('should search across sessions when scope is agent', async () => {
      const results = await manager.searchMemory({
        query: 'user settings',
        limit: 10,
        userId: 'user-123',
        scope: 'agent'
      });

      assert.ok(results.length > 0, 'Should find cross-session results');
    });
  });

  describe('Clear Session', () => {
    it('should clear all memories for session', async () => {
      client.reset();

      await manager.storeMemory({
        content: 'Memory 1',
        role: 'user',
        sessionId: 'clear-session'
      });
      await manager.storeMemory({
        content: 'Memory 2',
        role: 'user',
        sessionId: 'clear-session'
      });

      await manager.clearSession('clear-session');

      const context = await manager.getContext({
        sessionId: 'clear-session',
        maxTokens: 10000
      });

      assert.strictEqual(context.memories.length, 0, 'Should have no memories');
    });
  });
});
