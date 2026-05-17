/**
 * Plan Artifact MCP Tools — Refs #2904
 *
 * Persistent, diffable plan/PRD/task artifacts stored in ZeroDB.
 * Survives session boundaries. History tracked on every update.
 *
 * Tools:
 *   zerodb_plan_create  — Create a plan, PRD, or task artifact
 *   zerodb_plan_get     — Retrieve artifact by ID
 *   zerodb_plan_update  — Update content/title/status (diff stored automatically)
 *   zerodb_plan_history — Get version history with unified diffs
 */

const BASE = '/api/v1/public/memory/v2/plan';

export const PLAN_TOOLS = [
  {
    name: 'zerodb_plan_create',
    description: 'Create a persistent plan, PRD, or task artifact in ZeroDB. Returns an artifact ID you can pass to zerodb_plan_get/update/history in future sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Artifact title (max 200 chars)' },
        type: { type: 'string', enum: ['plan', 'prd', 'task'], description: 'Artifact type', default: 'plan' },
        content: { type: 'string', description: 'Markdown content' },
        session_id: { type: 'string', description: 'Optional session ID to associate with' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'zerodb_plan_get',
    description: 'Retrieve a plan artifact by ID. Use this at session start to restore a plan from a previous session.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Artifact ID returned by zerodb_plan_create' }
      },
      required: ['id']
    }
  },
  {
    name: 'zerodb_plan_update',
    description: 'Update a plan artifact. Content changes are diffed and stored in version history automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Artifact ID' },
        title: { type: 'string', description: 'New title (optional)' },
        content: { type: 'string', description: 'New content (optional)' },
        status: { type: 'string', enum: ['draft', 'active', 'completed'], description: 'New status (optional)' }
      },
      required: ['id']
    }
  },
  {
    name: 'zerodb_plan_history',
    description: 'Get version history for a plan artifact. Returns list of diffs showing how the plan evolved.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Artifact ID' }
      },
      required: ['id']
    }
  }
];

export async function executePlanTool(toolName, args, client) {
  switch (toolName) {
    case 'zerodb_plan_create':
      return client.request('POST', `${BASE}/`, {
        title: args.title,
        type: args.type || 'plan',
        content: args.content,
        session_id: args.session_id || null,
      });

    case 'zerodb_plan_get':
      return client.request('GET', `${BASE}/${args.id}`);

    case 'zerodb_plan_update':
      return client.request('PATCH', `${BASE}/${args.id}`, {
        ...(args.title && { title: args.title }),
        ...(args.content && { content: args.content }),
        ...(args.status && { status: args.status }),
      });

    case 'zerodb_plan_history':
      return client.request('GET', `${BASE}/${args.id}/history`);

    default:
      return null;
  }
}
