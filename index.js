#!/usr/bin/env node

/**
 * ZeroDB Agent Memory MCP Server
 *
 * Persistent memory for AI agents with advanced context management
 *
 * Features:
 * - 14 tools: 9 memory + 5 write-back
 * - ~1,200 token footprint
 * - Smart context window management
 * - Memory pruning (relevance, recency, hybrid)
 * - Memory importance scoring & decay
 * - Automatic embedding
 * - Cross-session memory
 * - Works with ZeroLocal AND Cloud
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('./package.json');

import { ZeroDBClient } from './src/client/zerodb-client.js';
import { MemoryManager } from './src/utils/memory-manager.js';
import { MEMORY_TOOLS, executeMemoryTool } from './src/tools/memory-tools.js';
import { WRITEBACK_TOOLS, executeWritebackTool } from './src/tools/writeback-tools.js';
import { PLAN_TOOLS, executePlanTool } from './src/tools/plan-tools.js';
import { autoContextHook, autoTraceHook } from './src/utils/auto-context.js';

// Load environment variables from .env
dotenv.config();

// If credentials still missing, scan up the directory tree for .mcp.json and load from it.
// This lets `npx ainative-zerodb-memory-mcp` work out of the box after `zerodb init`.
if (!process.env.ZERODB_API_KEY && !process.env.ZERODB_USERNAME) {
  const { existsSync, readFileSync } = await import('fs');
  const { dirname, join } = await import('path');
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidatePath = join(dir, '.mcp.json');
    if (existsSync(candidatePath)) {
      try {
        const mcp = JSON.parse(readFileSync(candidatePath, 'utf-8'));
        const servers = mcp.mcpServers || {};
        const zerodbServer = servers['zerodb-memory']
          || servers['ainative-zerodb-memory']
          || Object.values(servers).find(s => (s.args || []).join(' ').includes('zerodb'));
        const env = zerodbServer?.env;
        if (env) {
          if (env.ZERODB_API_KEY) process.env.ZERODB_API_KEY = env.ZERODB_API_KEY;
          if (env.ZERODB_USERNAME) process.env.ZERODB_USERNAME = env.ZERODB_USERNAME;
          if (env.ZERODB_PASSWORD) process.env.ZERODB_PASSWORD = env.ZERODB_PASSWORD;
          if (env.ZERODB_PROJECT_ID) process.env.ZERODB_PROJECT_ID = env.ZERODB_PROJECT_ID;
          if (env.ZERODB_API_URL) process.env.ZERODB_API_URL = env.ZERODB_API_URL;
          console.error(`☁️  Loaded credentials from ${candidatePath}`);
          break;
        }
      } catch (_) {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

// Configuration
const config = {
  // API endpoint (auto-detects local vs cloud)
  apiUrl: process.env.ZERODB_API_URL,
  username: process.env.ZERODB_USERNAME,
  password: process.env.ZERODB_PASSWORD,
  projectId: process.env.ZERODB_PROJECT_ID,

  // Context window management
  maxTokens: parseInt(process.env.CONTEXT_WINDOW) || 8192,
  pruneStrategy: process.env.PRUNE_STRATEGY || 'hybrid', // relevance, recency, hybrid

  // Memory configuration
  keepRecent: parseInt(process.env.KEEP_RECENT) || 5,
  keepImportant: process.env.KEEP_IMPORTANT !== 'false',

  // Summarization
  summarize: {
    enabled: process.env.SUMMARIZE_ENABLED !== 'false',
    afterMessages: parseInt(process.env.SUMMARIZE_AFTER) || 20,
    model: process.env.SUMMARY_MODEL || 'claude-3-haiku-20240307',
    keepOriginals: process.env.KEEP_ORIGINALS === 'true'
  },

  // Decay
  decay: {
    enabled: process.env.DECAY_ENABLED === 'true',
    halfLife: parseInt(process.env.DECAY_HALFLIFE) || 30,
    preserveTags: process.env.PRESERVE_TAGS?.split(',') || ['important', 'permanent']
  },

  // Auto-embedding
  autoEmbed: process.env.AUTO_EMBED !== 'false',
  embeddingModel: process.env.EMBEDDING_MODEL || 'BAAI/bge-small-en-v1.5'
};

// Global instances
let client = null;
let memoryManager = null;

/**
 * Initialize ZeroDB client and memory manager
 */
async function initialize() {
  // Display ZeroDB branding
  console.error('\n');
  console.error('  ███████╗███████╗██████╗  ██████╗');
  console.error('  ╚══███╔╝██╔════╝██╔══██╗██╔═══██╗');
  console.error('    ███╔╝ █████╗  ██████╔╝██║   ██║');
  console.error('   ███╔╝  ██╔══╝  ██╔══██╗██║   ██║');
  console.error('  ███████╗███████╗██║  ██║╚██████╔╝');
  console.error('  ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝');
  console.error('\n  ZeroDB - The AINative Database');
  console.error('\n===========================================');
  console.error(`  Agent Memory MCP Server v${PKG_VERSION}`);
  console.error('  Persistent Memory for AI Agents');
  console.error('===========================================\n');

  // Create and initialize client
  client = new ZeroDBClient(config);
  await client.initialize();

  // Warn if auth validation failed (tools that need auth will fail at runtime)
  if (client.authValid === false) {
    console.error('  Memory tools requiring authentication will return 401 errors.');
    console.error('  Server will continue running - some tools may still work.\n');
  }

  // Create memory manager with advanced features
  memoryManager = new MemoryManager(client, config);

  console.error('\n✅ Memory Manager initialized with:');
  console.error(`   • Context window: ${config.maxTokens} tokens`);
  console.error(`   • Prune strategy: ${config.pruneStrategy}`);
  console.error(`   • Keep recent: ${config.keepRecent} messages`);
  console.error(`   • Auto-embed: ${config.autoEmbed ? 'enabled' : 'disabled'}`);
  console.error(`   • Summarization: ${config.summarize.enabled ? 'enabled' : 'disabled'}`);
  console.error(`   • Memory decay: ${config.decay.enabled ? 'enabled' : 'disabled'}`);
  console.error('\n✅ 18 tools loaded (9 memory + 5 write-back + 4 plan-artifacts)');
  console.error('✅ Ready for agent connections!\n');
}

/**
 * Create and configure MCP server
 */
function createServer() {
  const server = new Server(
    {
      name: 'zerodb-memory-mcp',
      version: PKG_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools — memory tools + write-back tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [...MEMORY_TOOLS, ...WRITEBACK_TOOLS, ...PLAN_TOOLS]
    };
  });

  // Execute tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Auto-context middleware: inject memories before tool call if enabled
      // agent_id is resolved from args (write-back tools pass it explicitly; memory
      // tools use session_id or agent_id arg). Skip for config tools to avoid loops.
      const agentId = args?.agent_id || args?.session_id || null;
      const skipAutoContext = ['zerodb_configure_auto_context', 'zerodb_get_auto_context_config'].includes(name);
      let autoContext = null;
      if (agentId && !skipAutoContext) {
        const query = args?.query || args?.content || args?.message || args?.title || name;
        autoContext = await autoContextHook(agentId, query, client);
      }

      // Execute the tool
      let result = await executeWritebackTool(name, args || {}, client);
      if (result === null) result = await executePlanTool(name, args || {}, client);
      if (result === null) result = await executeMemoryTool(name, args || {}, memoryManager);

      // Auto-trace: store response as memory if enabled
      if (agentId && !skipAutoContext) {
        await autoTraceHook(agentId, name, result, client);
      }

      // Prepend auto-context if present
      const output = autoContext
        ? { _auto_context: autoContext, ...result }
        : result;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              tool: name,
              args
            }, null, 2)
          }
        ],
        isError: true
      };
    }
  });

  return server;
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Initialize connections
    await initialize();

    // Create server
    const server = createServer();

    // Start server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('📡 MCP Server connected and ready\n');
  } catch (error) {
    console.error('\n❌ Failed to start server:', error.message);

    if (error.message.includes('ZERODB_API_KEY') || error.message.includes('required')) {
      console.error('\n  No credentials found. Get a free API key in seconds:\n');
      console.error('    npx zerodb-cli init\n');
      console.error('  Then add your key to your MCP config:');
      console.error('    ZERODB_API_KEY=ak_your_key_here\n');
      console.error('  Or set it in a .env file in your project root.\n');
      console.error('  Docs: https://ainative.studio/.well-known/myterms.json\n');
    } else {
      console.error('\nPlease check:');
      console.error('  • ZERODB_API_KEY is set (recommended)');
      console.error('  • Or ZERODB_USERNAME and ZERODB_PASSWORD are set');
      console.error('  • ZeroLocal is running (if using localhost)');
      console.error('  • Network connection (if using cloud)\n');
      console.error('  Get credentials: npx zerodb-cli init\n');
    }
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
