/**
 * Example: Customer Support Agent with Persistent Memory
 *
 * Demonstrates:
 * - Storing customer preferences across sessions
 * - Cross-session memory search
 * - Importance tagging for critical information
 * - Context retrieval for personalized responses
 */

import { ZeroDBClient } from '../src/client/zerodb-client.js';
import { MemoryManager } from '../src/utils/memory-manager.js';

async function customerSupportAgent() {
  console.log('===========================================');
  console.log('  Customer Support Agent Example');
  console.log('===========================================\n');

  // Initialize client (auto-detects ZeroLocal or Cloud)
  const client = new ZeroDBClient({
    projectId: process.env.ZERODB_PROJECT_ID
  });
  await client.initialize();

  // Create memory manager
  const memory = new MemoryManager(client, {
    maxTokens: 8192,
    pruneStrategy: 'hybrid',
    keepRecent: 5,
    autoEmbed: true,
    decay: {
      enabled: true,
      halfLife: 30,
      preserveTags: ['critical', 'permanent']
    }
  });

  const customerId = 'customer-456';
  const sessionId = 'support-session-001';

  // Scenario 1: Store customer preferences
  console.log('📝 Storing customer preferences...\n');

  await memory.storeMemory({
    content: 'Customer prefers email support over phone calls',
    role: 'user',
    sessionId,
    tags: ['preference', 'communication'],
    metadata: { userId: customerId, category: 'communication' }
  });

  await memory.storeMemory({
    content: 'Customer timezone is PST (UTC-8)',
    role: 'system',
    sessionId,
    tags: ['preference', 'permanent'],
    metadata: { userId: customerId, category: 'timezone' }
  });

  await memory.storeMemory({
    content: 'Customer has premium support plan - priority handling',
    role: 'system',
    sessionId,
    tags: ['important', 'account'],
    metadata: { userId: customerId, category: 'account' }
  });

  // Scenario 2: Store critical issue information
  console.log('🚨 Storing critical issue information...\n');

  await memory.storeMemory({
    content: 'Customer experiencing login failures since 2026-02-27. Ticket #12345 created.',
    role: 'assistant',
    sessionId,
    tags: ['critical', 'issue', 'active'],
    metadata: {
      userId: customerId,
      category: 'technical-issue',
      ticketId: '12345',
      severity: 'high'
    }
  });

  // Scenario 3: New session - retrieve customer context
  console.log('🔄 New support session - retrieving customer context...\n');

  const newSessionId = 'support-session-002';

  // Search across all sessions for this customer
  const customerHistory = await memory.searchMemory({
    query: 'customer preferences and active issues',
    limit: 10,
    userId: customerId,
    scope: 'agent' // Search across all sessions
  });

  console.log(`Found ${customerHistory.length} relevant memories:\n`);
  customerHistory.forEach((mem, idx) => {
    console.log(`${idx + 1}. [${mem.role}] ${mem.content}`);
    console.log(`   Importance: ${(mem.metadata?.importance || 0).toFixed(2)}`);
    console.log(`   Tags: ${mem.metadata?.tags?.join(', ') || 'none'}\n`);
  });

  // Scenario 4: Context-aware response
  console.log('💬 Generating context-aware response...\n');

  const context = await memory.getContext({
    sessionId,
    maxTokens: 4096,
    includeStats: true
  });

  console.log(`Context window: ${context.total_tokens} tokens`);
  console.log(`Memories: ${context.memories.length}`);
  console.log(`Pruned: ${context.stats?.pruned || false}\n`);

  // Scenario 5: Store resolution
  console.log('✅ Storing issue resolution...\n');

  await memory.storeMemory({
    content: 'Login issue resolved. Password reset link sent. Customer confirmed successful login.',
    role: 'assistant',
    sessionId: newSessionId,
    tags: ['resolution', 'important'],
    metadata: {
      userId: customerId,
      category: 'resolution',
      ticketId: '12345',
      resolvedAt: new Date().toISOString()
    }
  });

  // Scenario 6: Search for similar issues (semantic search)
  console.log('🔍 Searching for similar login issues across all customers...\n');

  const similarIssues = await memory.searchMemory({
    query: 'login failures and authentication problems',
    limit: 5,
    scope: 'global' // Search across all customers
  });

  console.log(`Found ${similarIssues.length} similar issues:\n`);
  similarIssues.forEach((issue, idx) => {
    console.log(`${idx + 1}. ${issue.content.substring(0, 80)}...`);
    console.log(`   Similarity: ${(issue.similarity || 0).toFixed(2)}\n`);
  });

  // Scenario 7: Clean up test session
  console.log('🧹 Cleaning up test sessions...\n');

  await memory.clearSession(sessionId);
  await memory.clearSession(newSessionId);

  console.log('✅ Example completed!\n');
  console.log('Key Takeaways:');
  console.log('  • Customer preferences persist across sessions');
  console.log('  • Critical information is preserved with tags');
  console.log('  • Context-aware responses improve support quality');
  console.log('  • Semantic search finds related issues\n');
}

// Run example
if (import.meta.url === `file://${process.argv[1]}`) {
  customerSupportAgent().catch(console.error);
}

export { customerSupportAgent };
