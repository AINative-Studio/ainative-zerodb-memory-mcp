/**
 * Example: Personal Assistant with Long-Term Memory
 *
 * Demonstrates:
 * - Storing user preferences and habits
 * - Memory importance scoring
 * - Memory decay for old information
 * - Context window management
 * - Smart pruning strategies
 */

import { ZeroDBClient } from '../src/client/zerodb-client.js';
import { MemoryManager } from '../src/utils/memory-manager.js';

async function personalAssistant() {
  console.log('===========================================');
  console.log('  Personal Assistant Example');
  console.log('===========================================\n');

  // Initialize with memory decay enabled
  const client = new ZeroDBClient({
    projectId: process.env.ZERODB_PROJECT_ID
  });
  await client.initialize();

  const memory = new MemoryManager(client, {
    maxTokens: 8192,
    pruneStrategy: 'hybrid',
    keepRecent: 5,
    keepImportant: true,
    autoEmbed: true,
    decay: {
      enabled: true,
      halfLife: 30, // Memories decay over 30 days
      preserveTags: ['permanent', 'important']
    },
    summarize: {
      enabled: true,
      afterMessages: 20
    }
  });

  const userId = 'user-123';
  const sessionId = 'assistant-session-001';

  // Scenario 1: Store permanent user information
  console.log('💾 Storing permanent user information...\n');

  await memory.storeMemory({
    content: 'User\'s birthday is March 15th, 1990',
    role: 'system',
    sessionId,
    tags: ['permanent', 'important', 'personal'],
    metadata: {
      userId,
      category: 'personal-info',
      type: 'birthday'
    }
  });

  await memory.storeMemory({
    content: 'User lives in San Francisco, California, USA',
    role: 'system',
    sessionId,
    tags: ['permanent', 'location'],
    metadata: {
      userId,
      category: 'personal-info',
      type: 'location'
    }
  });

  await memory.storeMemory({
    content: 'User is allergic to shellfish and tree nuts',
    role: 'system',
    sessionId,
    tags: ['permanent', 'critical', 'health'],
    metadata: {
      userId,
      category: 'health',
      type: 'allergy'
    }
  });

  // Scenario 2: Store preferences (subject to decay)
  console.log('⚙️  Storing user preferences...\n');

  await memory.storeMemory({
    content: 'User prefers morning workouts at 6 AM',
    role: 'user',
    sessionId,
    tags: ['preference', 'routine'],
    metadata: {
      userId,
      category: 'lifestyle',
      type: 'routine'
    }
  });

  await memory.storeMemory({
    content: 'User currently reading "The Psychology of Money"',
    role: 'user',
    sessionId,
    tags: ['temporary', 'interest'],
    metadata: {
      userId,
      category: 'entertainment',
      type: 'current-reading'
    }
  });

  // Scenario 3: Store daily interactions
  console.log('💬 Simulating daily interactions...\n');

  const dailyMessages = [
    'What\'s the weather like today?',
    'Remind me to call mom at 3 PM',
    'Find restaurants near me',
    'What\'s on my calendar for tomorrow?',
    'Add milk to shopping list',
    'Play some jazz music',
    'Set timer for 25 minutes',
    'What time is it in Tokyo?'
  ];

  for (const msg of dailyMessages) {
    await memory.storeMemory({
      content: msg,
      role: 'user',
      sessionId,
      tags: ['conversation'],
      metadata: {
        userId,
        category: 'daily-interaction'
      }
    });
  }

  // Scenario 4: Get context with smart pruning
  console.log('📊 Retrieving context with smart pruning...\n');

  const context = await memory.getContext({
    sessionId,
    maxTokens: 500 // Tight budget to trigger pruning
  });

  console.log(`Context retrieved:`);
  console.log(`  Total memories: ${context.stats?.original_count || context.memories.length}`);
  console.log(`  Kept: ${context.memories.length}`);
  console.log(`  Pruned: ${context.stats?.pruned ? 'Yes' : 'No'}`);
  console.log(`  Token usage: ${context.total_tokens}/${500}\n`);

  console.log('Kept memories (in order):');
  context.memories.forEach((mem, idx) => {
    console.log(`  ${idx + 1}. [${mem.role}] ${mem.content.substring(0, 60)}...`);
    console.log(`     Importance: ${(mem.importance || 0).toFixed(2)}`);
    console.log(`     Tags: ${mem.tags?.join(', ') || 'none'}\n`);
  });

  // Scenario 5: Search for specific information
  console.log('🔍 Searching for health-related information...\n');

  const healthInfo = await memory.searchMemory({
    query: 'health allergies dietary restrictions',
    limit: 5,
    sessionId,
    scope: 'session'
  });

  console.log(`Found ${healthInfo.length} health-related memories:\n`);
  healthInfo.forEach((mem, idx) => {
    console.log(`${idx + 1}. ${mem.content}`);
    console.log(`   Importance: ${(mem.importance || 0).toFixed(2)}`);
    console.log(`   Tags: ${mem.tags?.join(', ') || 'none'}\n`);
  });

  // Scenario 6: Semantic search for similar queries
  console.log('🧠 Semantic search for similar past questions...\n');

  const similar = await memory.searchMemory({
    query: 'time and scheduling questions',
    limit: 3,
    sessionId,
    scope: 'session'
  });

  console.log(`Found ${similar.length} similar past questions:\n`);
  similar.forEach((mem, idx) => {
    console.log(`${idx + 1}. "${mem.content}"`);
    console.log(`   Similarity: ${(mem.similarity || 0).toFixed(2)}\n`);
  });

  // Scenario 7: Demonstrate importance-based filtering
  console.log('⭐ Filtering high-importance memories only...\n');

  const allMemories = await memory.searchMemory({
    query: '',
    limit: 100,
    sessionId,
    scope: 'session'
  });

  const important = allMemories.filter(m => (m.importance || 0) >= 0.8);

  console.log(`Total memories: ${allMemories.length}`);
  console.log(`High importance (≥0.8): ${important.length}\n`);

  important.forEach((mem, idx) => {
    console.log(`${idx + 1}. ${mem.content.substring(0, 60)}...`);
    console.log(`   Importance: ${mem.importance.toFixed(2)}`);
    console.log(`   Tags: ${mem.tags?.join(', ') || 'none'}\n`);
  });

  // Clean up
  console.log('🧹 Cleaning up test session...\n');
  await memory.clearSession(sessionId);

  console.log('✅ Example completed!\n');
  console.log('Key Features Demonstrated:');
  console.log('  ✓ Permanent memories with "permanent" tag');
  console.log('  ✓ Memory decay for temporary information');
  console.log('  ✓ Importance-based filtering');
  console.log('  ✓ Smart context pruning');
  console.log('  ✓ Semantic search');
  console.log('  ✓ Cross-category memory retrieval\n');

  console.log('Memory Management Benefits:');
  console.log('  • Important info (birthdays, allergies) never forgotten');
  console.log('  • Old preferences naturally fade over time');
  console.log('  • Context stays within token limits automatically');
  console.log('  • Smart retrieval finds relevant memories\n');
}

// Run example
if (import.meta.url === `file://${process.argv[1]}`) {
  personalAssistant().catch(console.error);
}

export { personalAssistant };
