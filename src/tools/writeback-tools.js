/**
 * Native Write-Back MCP Tools — Issues #2645-#2649
 *
 * Five action tools that use stored OAuth tokens from sync_connections to
 * write back to external services. No API keys required from the user —
 * tokens come from their connected accounts in ZeroDB.
 *
 * Tools:
 *   zerodb_slack_send          — Send a Slack message (#2645)
 *   zerodb_gmail_reply         — Reply to a Gmail thread (#2646)
 *   zerodb_calendar_create     — Create a Google Calendar event (#2647)
 *   zerodb_github_create_issue — Create a GitHub issue (#2648)
 *   zerodb_notion_create_page  — Create a Notion page (#2649)
 */

export const WRITEBACK_TOOLS = [
  {
    name: 'zerodb_slack_send',
    description: 'Send a Slack message using your stored Slack OAuth connection. No API key required — uses the token from your connected Slack account in ZeroDB.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Slack channel name (e.g. "#general") or channel ID'
        },
        message: {
          type: 'string',
          description: 'Message text. Supports Slack mrkdwn formatting.'
        },
        thread_ts: {
          type: 'string',
          description: 'Optional. Thread timestamp to reply in an existing thread.'
        }
      },
      required: ['channel', 'message']
    }
  },

  {
    name: 'zerodb_gmail_reply',
    description: 'Reply to a Gmail thread using your stored Google OAuth connection. Sends from your connected Gmail account.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Gmail thread ID to reply to'
        },
        body: {
          type: 'string',
          description: 'Reply body (plain text or HTML)'
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of CC email addresses',
          default: []
        }
      },
      required: ['thread_id', 'body']
    }
  },

  {
    name: 'zerodb_calendar_create',
    description: 'Create a Google Calendar event using your stored Google OAuth connection.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Event title / summary'
        },
        start: {
          type: 'string',
          description: 'Start datetime in ISO 8601 format (e.g. "2026-05-10T14:00:00-07:00")'
        },
        end: {
          type: 'string',
          description: 'End datetime in ISO 8601 format'
        },
        description: {
          type: 'string',
          description: 'Optional event description',
          default: ''
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of attendee email addresses',
          default: []
        },
        calendar_id: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
          default: 'primary'
        }
      },
      required: ['title', 'start', 'end']
    }
  },

  {
    name: 'zerodb_github_create_issue',
    description: 'Create a GitHub issue using your stored GitHub OAuth connection.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format (e.g. "acme/backend")'
        },
        title: {
          type: 'string',
          description: 'Issue title'
        },
        body: {
          type: 'string',
          description: 'Issue body / description (markdown supported)',
          default: ''
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of label names',
          default: []
        }
      },
      required: ['repo', 'title']
    }
  },

  {
    name: 'zerodb_notion_create_page',
    description: 'Create a Notion page using your stored Notion OAuth connection.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: {
          type: 'string',
          description: 'Parent page or database ID to create the page under'
        },
        title: {
          type: 'string',
          description: 'Page title'
        },
        content: {
          type: 'string',
          description: 'Page content as plain text or markdown. Converted to Notion blocks automatically.',
          default: ''
        }
      },
      required: ['parent_id', 'title']
    }
  }
];

/**
 * Execute a write-back tool.
 */
export async function executeWritebackTool(toolName, args, client) {
  switch (toolName) {
    case 'zerodb_slack_send':
      return await handleSlackSend(args, client);
    case 'zerodb_gmail_reply':
      return await handleGmailReply(args, client);
    case 'zerodb_calendar_create':
      return await handleCalendarCreate(args, client);
    case 'zerodb_github_create_issue':
      return await handleGithubCreateIssue(args, client);
    case 'zerodb_notion_create_page':
      return await handleNotionCreatePage(args, client);
    default:
      return null; // Not a writeback tool
  }
}

// ---------------------------------------------------------------------------
// Slack — #2645
// ---------------------------------------------------------------------------

async function handleSlackSend(args, client) {
  const result = await client.request('POST', '/api/v1/public/memory/v2/actions/slack/send', {
    channel: args.channel,
    message: args.message,
    thread_ts: args.thread_ts || null,
  });

  return {
    success: true,
    ts: result.ts || result.message_ts,
    channel: result.channel || args.channel,
    message: 'Message sent successfully',
  };
}

// ---------------------------------------------------------------------------
// Gmail — #2646
// ---------------------------------------------------------------------------

async function handleGmailReply(args, client) {
  const result = await client.request('POST', '/api/v1/public/memory/v2/actions/gmail/reply', {
    thread_id: args.thread_id,
    body: args.body,
    cc: args.cc || [],
  });

  return {
    success: true,
    message_id: result.id || result.message_id,
    thread_id: args.thread_id,
    message: 'Reply sent successfully',
  };
}

// ---------------------------------------------------------------------------
// Google Calendar — #2647
// ---------------------------------------------------------------------------

async function handleCalendarCreate(args, client) {
  const result = await client.request('POST', '/api/v1/public/memory/v2/actions/calendar/create', {
    title: args.title,
    start: args.start,
    end: args.end,
    description: args.description || '',
    attendees: args.attendees || [],
    calendar_id: args.calendar_id || 'primary',
  });

  return {
    success: true,
    event_id: result.id || result.event_id,
    html_link: result.html_link || result.event_url,
    title: args.title,
    message: 'Event created successfully',
  };
}

// ---------------------------------------------------------------------------
// GitHub — #2648
// ---------------------------------------------------------------------------

async function handleGithubCreateIssue(args, client) {
  const result = await client.request('POST', '/api/v1/public/memory/v2/actions/github/issue', {
    repo: args.repo,
    title: args.title,
    body: args.body || '',
    labels: args.labels || [],
  });

  return {
    success: true,
    issue_number: result.number || result.issue_number,
    url: result.html_url || result.url,
    title: args.title,
    message: 'Issue created successfully',
  };
}

// ---------------------------------------------------------------------------
// Notion — #2649
// ---------------------------------------------------------------------------

async function handleNotionCreatePage(args, client) {
  const result = await client.request('POST', '/api/v1/public/memory/v2/actions/notion/page', {
    parent_id: args.parent_id,
    title: args.title,
    content: args.content || '',
  });

  return {
    success: true,
    page_id: result.id || result.page_id,
    url: result.url || result.page_url,
    title: args.title,
    message: 'Page created successfully',
  };
}
