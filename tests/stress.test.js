/**
 * Stress Tests for Agent Memory MCP
 *
 * Tests system stability under heavy load:
 * - Large datasets (1000+ memories)
 * - Extreme token limits
 * - Concurrent operations
 * - Edge cases and boundary conditions
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MemoryManager } from '../src/utils/memory-manager.js';

// Mock client
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
    return filtered.slice(0, limit);
  }

  async getContext({ sessionId, maxTokens }) {
    const filtered = this.memories.filter(m => m.session_id === sessionId);
    return { memories: filtered };
  }

  async embedText(text) {
    return { embedding: Array(384).fill(0).map(() => Math.random()) };
  }

  async clearSession(sessionId) {
    this.memories = this.memories.filter(m => m.session_id !== sessionId);
    return { success: true };
  }

  reset() {
    this.memories = [];
    this.nextId = 1;
  }
}

describe('Stress Tests', () => {
  let client;
  let manager;

  before(() => {
    client = new MockClient();
    manager = new MemoryManager(client, {
      maxTokens: 8192,
      pruneStrategy: 'hybrid',
      keepRecent: 5,
      autoEmbed: false  // Disable for speed
    });
  });

  describe('Large Dataset Tests', () => {
    it('should handle 1000+ memories efficiently', async () => {
      client.reset();
      const sessionId = 'stress-session-large';
      const count = 1000;

      // Store 1000 memories
      const startStore = Date.now();
      for (let i = 0; i < count; i++) {
        await manager.storeMemory({
          content: `Memory ${i}: ${'x'.repeat(100)}`,
          role: i % 3 === 0 ? 'system' : 'user',
          sessionId,
          tags: i % 10 === 0 ? ['important'] : []
        });
      }
      const storeTime = Date.now() - startStore;

      assert.strictEqual(client.memories.length, count);
      console.log(`  Stored ${count} memories in ${storeTime}ms (${(storeTime / count).toFixed(2)}ms per memory)`);
    });

    it('should prune 1000 memories to fit token budget', async () => {
      client.reset();
      const sessionId = 'stress-session-prune';

      // Create 1000 memories
      const memories = [];
      for (let i = 0; i < 1000; i++) {
        memories.push({
          id: i,
          content: 'x'.repeat(100), // 25 tokens each
          role: 'user',
          metadata: {
            importance: Math.random(),
            timestamp: new Date(Date.now() - i * 1000).toISOString()
          }
        });
      }

      // Prune to 100 tokens (should keep ~4 memories)
      const startPrune = Date.now();
      const pruned = await manager.pruneMemories(memories, 100);
      const pruneTime = Date.now() - startPrune;

      assert.ok(pruned.length < 10, 'Should heavily prune');
      assert.ok(pruned.length >= 3, 'Should keep at least keepRecent');
      console.log(`  Pruned 1000 memories in ${pruneTime}ms`);
      console.log(`  Kept ${pruned.length} memories (${((pruned.length / 1000) * 100).toFixed(1)}%)`);
    });

    it('should search through 1000+ memories quickly', async () => {
      // Memories already stored from previous test
      const sessionId = 'stress-session-large';

      const startSearch = Date.now();
      const results = await manager.searchMemory({
        query: 'important information',
        limit: 10,
        sessionId,
        scope: 'session'
      });
      const searchTime = Date.now() - startSearch;

      assert.ok(results.length <= 10);
      console.log(`  Searched 1000+ memories in ${searchTime}ms`);
    });
  });

  describe('Extreme Token Limits', () => {
    it('should handle very small token budgets', async () => {
      const memories = Array(20).fill(0).map((_, i) => ({
        id: i,
        content: 'x'.repeat(100),
        role: 'user',
        metadata: {
          importance: 0.5,
          timestamp: new Date(Date.now() - i * 1000).toISOString()
        }
      }));

      // Budget so small it can only fit 1 memory
      const pruned = await manager.pruneMemories(memories, 25);

      assert.ok(pruned.length >= 1, 'Should keep at least 1 memory');
      assert.ok(pruned.length <= 5, 'Should not exceed keepRecent');
    });

    it('should handle very large token budgets', async () => {
      const memories = Array(100).fill(0).map((_, i) => ({
        id: i,
        content: 'x'.repeat(100),
        role: 'user',
        metadata: {
          importance: 0.5,
          timestamp: new Date(Date.now() - i * 1000).toISOString()
        }
      }));

      // Budget larger than all memories combined
      const pruned = await manager.pruneMemories(memories, 10000);

      assert.strictEqual(pruned.length, 100, 'Should keep all memories when budget allows');
    });

    it('should handle zero and negative token budgets gracefully', async () => {
      const memories = Array(10).fill(0).map((_, i) => ({
        id: i,
        content: 'x'.repeat(100),
        role: 'user',
        metadata: {
          importance: 0.5,
          timestamp: new Date().toISOString()
        }
      }));

      const prunedZero = await manager.pruneMemories(memories, 0);
      const prunedNegative = await manager.pruneMemories(memories, -100);

      assert.ok(prunedZero.length === 0 || prunedZero.length <= manager.keepRecent, 'Should handle zero budget');
      assert.ok(prunedNegative.length === 0 || prunedNegative.length <= manager.keepRecent, 'Should handle negative budget');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty memory list', async () => {
      const pruned = await manager.pruneMemories([], 1000);
      assert.strictEqual(pruned.length, 0);
    });

    it('should handle memories without timestamps', async () => {
      const memories = [
        {
          id: 1,
          content: 'No timestamp',
          role: 'user',
          metadata: {}  // No timestamp
        }
      ];

      const pruned = await manager.pruneMemories(memories, 100);
      assert.strictEqual(pruned.length, 1, 'Should handle missing timestamps');
    });

    it('should handle extremely long content', async () => {
      client.reset();
      const longContent = 'x'.repeat(100000); // 25,000 tokens

      const result = await manager.storeMemory({
        content: longContent,
        role: 'user',
        sessionId: 'stress-long-content'
      });

      assert.ok(result.id, 'Should handle very long content');
      assert.ok(result.metadata.importance, 'Should calculate importance for long content');
    });

    it('should handle all memories with same importance', async () => {
      const memories = Array(10).fill(0).map((_, i) => ({
        id: i,
        content: 'x'.repeat(100),
        role: 'user',
        metadata: {
          importance: 0.5,  // All same
          timestamp: new Date(Date.now() - i * 1000).toISOString()
        }
      }));

      const pruned = await manager.pruneMemories(memories, 100);
      assert.ok(pruned.length > 0, 'Should handle identical importance scores');
    });

    it('should handle memories with extreme importance scores', async () => {
      const memories = [
        {
          id: 1,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: { importance: 1.0, timestamp: new Date().toISOString() }
        },
        {
          id: 2,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: { importance: 0.0, timestamp: new Date().toISOString() }
        },
        {
          id: 3,
          content: 'x'.repeat(100),
          role: 'user',
          metadata: { importance: 0.99, timestamp: new Date().toISOString() }
        }
      ];

      const pruned = await manager.pruneMemories(memories, 50);
      assert.ok(pruned.length > 0, 'Should handle extreme importance values');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent pruning operations', async () => {
      const memories = Array(100).fill(0).map((_, i) => ({
        id: i,
        content: 'x'.repeat(100),
        role: 'user',
        metadata: {
          importance: Math.random(),
          timestamp: new Date(Date.now() - i * 1000).toISOString()
        }
      }));

      // Run 10 pruning operations concurrently
      const promises = Array(10).fill(0).map(() =>
        manager.pruneMemories(memories, 200)
      );

      const results = await Promise.all(promises);

      // All should complete successfully
      results.forEach(result => {
        assert.ok(Array.isArray(result), 'Should return array');
        assert.ok(result.length > 0, 'Should return some memories');
      });

      console.log(`  Completed 10 concurrent pruning operations`);
    });

    it('should handle concurrent store operations', async () => {
      client.reset();
      const sessionId = 'concurrent-store';

      // Store 100 memories concurrently
      const promises = Array(100).fill(0).map((_, i) =>
        manager.storeMemory({
          content: `Concurrent memory ${i}`,
          role: 'user',
          sessionId
        })
      );

      const results = await Promise.all(promises);

      assert.strictEqual(results.length, 100);
      results.forEach(result => {
        assert.ok(result.id, 'Should have ID');
      });

      console.log(`  Stored 100 memories concurrently`);
    });
  });

  describe('Memory Distribution Tests', () => {
    it('should handle varied content lengths efficiently', async () => {
      const memories = [
        { id: 1, content: 'x', role: 'user', metadata: { importance: 0.5, timestamp: new Date().toISOString() } },
        { id: 2, content: 'x'.repeat(10), role: 'user', metadata: { importance: 0.5, timestamp: new Date().toISOString() } },
        { id: 3, content: 'x'.repeat(100), role: 'user', metadata: { importance: 0.5, timestamp: new Date().toISOString() } },
        { id: 4, content: 'x'.repeat(1000), role: 'user', metadata: { importance: 0.5, timestamp: new Date().toISOString() } },
        { id: 5, content: 'x'.repeat(10000), role: 'user', metadata: { importance: 0.5, timestamp: new Date().toISOString() } }
      ];

      const pruned = await manager.pruneMemories(memories, 500);
      assert.ok(pruned.length > 0, 'Should handle varied lengths');
    });
  });
});
