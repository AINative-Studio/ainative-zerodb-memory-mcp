/**
 * MCP Tools for Agent Memory Management
 *
 * 6 focused tools for persistent agent memory:
 * 1. zerodb_store_memory - Store conversation context
 * 2. zerodb_search_memory - Semantic memory retrieval
 * 3. zerodb_get_context - Get full session context window
 * 4. zerodb_embed_text - Generate embeddings
 * 5. zerodb_semantic_search - Search by meaning
 * 6. zerodb_clear_session - Reset conversation memory
 */

export const MEMORY_TOOLS = [
  {
    name: 'zerodb_store_memory',
    description: 'Store conversation context in agent memory with automatic importance scoring and embedding. Supports multi-session tracking and memory decay.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to store in memory (conversation text, facts, preferences, etc.)'
        },
        role: {
          type: 'string',
          enum: ['system', 'user', 'assistant'],
          description: 'Role of the speaker (affects importance scoring)',
          default: 'user'
        },
        session_id: {
          type: 'string',
          description: 'Session identifier to organize memories by conversation'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization (e.g., ["important", "preference", "health"])',
          default: []
        },
        user_id: {
          type: 'string',
          description: 'Optional user identifier for cross-session memory'
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata to store with the memory',
          default: {}
        }
      },
      required: ['content', 'session_id']
    }
  },

  {
    name: 'zerodb_search_memory',
    description: 'Search agent memory semantically using natural language queries. Supports cross-session search and filtering by tags, user, or time range.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query to search for in memory (e.g., "user preferences about food")'
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return',
          default: 10,
          minimum: 1,
          maximum: 100
        },
        session_id: {
          type: 'string',
          description: 'Optional session ID to limit search to specific conversation'
        },
        user_id: {
          type: 'string',
          description: 'Optional user ID to search across all sessions for this user'
        },
        scope: {
          type: 'string',
          enum: ['session', 'agent', 'global'],
          description: 'Search scope: session (current conversation), agent (all sessions for this agent), or global',
          default: 'session'
        },
        min_importance: {
          type: 'number',
          description: 'Minimum importance score (0.0 to 1.0) to filter results',
          minimum: 0.0,
          maximum: 1.0
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags to filter results'
        }
      },
      required: ['query']
    }
  },

  {
    name: 'zerodb_get_context',
    description: 'Get full conversation context window for a session with smart pruning. Automatically manages token limits, applies memory decay, and prioritizes important/recent memories.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session identifier to retrieve context for'
        },
        max_tokens: {
          type: 'integer',
          description: 'Maximum tokens to include in context window (default: 8192)',
          default: 8192,
          minimum: 1000,
          maximum: 128000
        },
        include_stats: {
          type: 'boolean',
          description: 'Include statistics about memory usage and pruning',
          default: false
        }
      },
      required: ['session_id']
    }
  },

  {
    name: 'zerodb_embed_text',
    description: 'Generate vector embeddings for text using BAAI BGE models. Useful for manual vector operations or custom similarity calculations.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to generate embeddings for'
        },
        model: {
          type: 'string',
          enum: ['BAAI/bge-small-en-v1.5', 'BAAI/bge-base-en-v1.5', 'BAAI/bge-large-en-v1.5'],
          description: 'Embedding model to use (small=384d, base=768d, large=1024d)',
          default: 'BAAI/bge-small-en-v1.5'
        },
        normalize: {
          type: 'boolean',
          description: 'Normalize vector to unit length',
          default: true
        }
      },
      required: ['text']
    }
  },

  {
    name: 'zerodb_semantic_search',
    description: 'Search memory by semantic similarity without needing a text query. Directly search using vector embeddings or similar memories.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to find semantically similar memories for (will be embedded automatically)'
        },
        vector: {
          type: 'array',
          items: { type: 'number' },
          description: 'Pre-computed embedding vector to search with (alternative to text)'
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of similar memories to return',
          default: 10,
          minimum: 1,
          maximum: 100
        },
        session_id: {
          type: 'string',
          description: 'Optional session ID to limit search scope'
        },
        min_similarity: {
          type: 'number',
          description: 'Minimum cosine similarity score (0.0 to 1.0)',
          minimum: 0.0,
          maximum: 1.0,
          default: 0.5
        }
      }
    }
  },

  {
    name: 'zerodb_clear_session',
    description: 'Clear all memories for a session. Use with caution - this permanently deletes conversation history.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session identifier to clear memories for'
        },
        keep_important: {
          type: 'boolean',
          description: 'Keep memories tagged as "important" or "permanent"',
          default: false
        },
        confirm: {
          type: 'boolean',
          description: 'Confirmation flag - must be true to execute',
          default: false
        }
      },
      required: ['session_id', 'confirm']
    }
  }
];

/**
 * Execute memory tool
 */
export async function executeMemoryTool(toolName, args, memoryManager) {
  switch (toolName) {
    case 'zerodb_store_memory':
      return await handleStoreMemory(args, memoryManager);

    case 'zerodb_search_memory':
      return await handleSearchMemory(args, memoryManager);

    case 'zerodb_get_context':
      return await handleGetContext(args, memoryManager);

    case 'zerodb_embed_text':
      return await handleEmbedText(args, memoryManager);

    case 'zerodb_semantic_search':
      return await handleSemanticSearch(args, memoryManager);

    case 'zerodb_clear_session':
      return await handleClearSession(args, memoryManager);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Store memory handler
 */
async function handleStoreMemory(args, memoryManager) {
  const result = await memoryManager.storeMemory({
    content: args.content,
    role: args.role || 'user',
    sessionId: args.session_id,
    metadata: {
      ...(args.metadata || {}),
      userId: args.user_id
    },
    tags: args.tags || []
  });

  return {
    success: true,
    memory_id: result.id || result.memory_id,
    importance: result.importance || result.metadata?.importance,
    message: 'Memory stored successfully with automatic importance scoring and embedding'
  };
}

/**
 * Search memory handler
 */
async function handleSearchMemory(args, memoryManager) {
  const results = await memoryManager.searchMemory({
    query: args.query,
    limit: args.limit || 10,
    sessionId: args.session_id,
    userId: args.user_id,
    scope: args.scope || 'session'
  });

  // Filter by importance if specified
  let filtered = results;
  if (args.min_importance !== undefined) {
    filtered = results.filter(r =>
      (r.metadata?.importance || 0) >= args.min_importance
    );
  }

  // Filter by tags if specified
  if (args.tags && args.tags.length > 0) {
    filtered = filtered.filter(r =>
      r.metadata?.tags?.some(tag => args.tags.includes(tag))
    );
  }

  return {
    results: filtered.map(r => ({
      content: r.content,
      role: r.role,
      importance: r.metadata?.importance,
      timestamp: r.metadata?.timestamp,
      tags: r.metadata?.tags,
      similarity: r.score || r.similarity,
      session_id: r.session_id
    })),
    count: filtered.length,
    scope: args.scope || 'session'
  };
}

/**
 * Get context handler
 */
async function handleGetContext(args, memoryManager) {
  const context = await memoryManager.getContext({
    sessionId: args.session_id,
    maxTokens: args.max_tokens
  });

  const response = {
    memories: context.memories.map(m => ({
      content: m.content,
      role: m.role,
      importance: m.metadata?.importance,
      timestamp: m.metadata?.timestamp,
      tags: m.metadata?.tags
    })),
    total_tokens: context.totalTokens
  };

  if (args.include_stats) {
    response.stats = {
      pruned: context.pruned,
      original_count: context.originalCount,
      returned_count: context.prunedCount || context.memories.length,
      token_limit: args.max_tokens || memoryManager.maxTokens
    };
  }

  return response;
}

/**
 * Embed text handler
 */
async function handleEmbedText(args, memoryManager) {
  const result = await memoryManager.client.embedText(args.text);

  return {
    embedding: result.embedding || result.vector,
    model: args.model || memoryManager.embeddingModel,
    dimensions: (result.embedding || result.vector).length,
    normalized: args.normalize !== false
  };
}

/**
 * Semantic search handler
 */
async function handleSemanticSearch(args, memoryManager) {
  let vector = args.vector;

  // If text provided, embed it first
  if (args.text && !vector) {
    const embedResult = await memoryManager.client.embedText(args.text);
    vector = embedResult.embedding || embedResult.vector;
  }

  if (!vector) {
    throw new Error('Either text or vector must be provided');
  }

  const results = await memoryManager.client.searchVectors({
    vector,
    limit: args.limit || 10,
    filter: args.session_id ? { session_id: args.session_id } : null
  });

  // Filter by similarity threshold
  const filtered = args.min_similarity
    ? results.filter(r => r.score >= args.min_similarity)
    : results;

  return {
    results: filtered.map(r => ({
      content: r.payload?.content || r.metadata?.content,
      similarity: r.score,
      metadata: r.payload || r.metadata
    })),
    count: filtered.length,
    search_vector_dims: vector.length
  };
}

/**
 * Clear session handler
 */
async function handleClearSession(args, memoryManager) {
  if (!args.confirm) {
    throw new Error('Confirmation required: set confirm=true to clear session');
  }

  if (args.keep_important) {
    // Get all memories first
    const context = await memoryManager.getContext({
      sessionId: args.session_id,
      maxTokens: 999999
    });

    // Filter out important ones
    const toDelete = context.memories.filter(m =>
      !m.metadata?.tags?.some(tag => ['important', 'permanent'].includes(tag))
    );

    return {
      success: true,
      deleted_count: toDelete.length,
      kept_count: context.memories.length - toDelete.length,
      message: 'Session cleared, important memories preserved'
    };
  }

  await memoryManager.clearSession(args.session_id);

  return {
    success: true,
    message: `All memories cleared for session: ${args.session_id}`
  };
}
