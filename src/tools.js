import { z } from "zod";
import { getContexts } from "./db.js";
import {
  capture,
  search,
  recent,
  confirm,
  dispute,
  getReviewQueue,
  detectPatterns,
  generateDigest,
} from "./core.js";

/**
 * Register all brain tools onto an McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('better-sqlite3').Database} db
 */
export function registerTools(server, db) {
  // ─── search_brain ───────────────────────────────────────────────────────────

  server.registerTool(
    "search_brain",
    {
      title: "Search Brain",
      description:
        "Semantically search the second brain. Returns thoughts ranked by relevance, with quality warnings where applicable.",
      inputSchema: {
        query: z.string().describe("Natural language search query (English or Romanian)"),
        context: z.string().optional().describe("Bias results toward a specific context (e.g. work, gamedev)"),
        project: z.string().optional().describe("Filter to a specific project"),
        limit: z.number().int().positive().optional().default(5),
      },
    },
    async ({ query, context, project, limit }) => {
      const results = await search(db, query, { context, project, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              results.map((r) => ({
                id: r.id,
                text: r.text,
                context: r.context,
                project: r.project,
                topics: r.topics,
                confidence: r.confidence,
                staleness: r.staleness,
                hit_count: r.hit_count,
                warning: r.warning ?? undefined,
                created_at: r.created_at,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── capture_thought ────────────────────────────────────────────────────────

  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought",
      description:
        "Save a thought, note, or piece of knowledge to the second brain. Embedding happens in the background.",
      inputSchema: {
        text: z.string().describe("The content to capture"),
        context: z.string().optional().describe("Context: work, passion, gamedev, or any configured context"),
        project: z.string().optional().describe("Project name this thought belongs to"),
        topics: z.array(z.string()).optional().describe("Tags for this thought"),
        source_type: z
          .enum(["firsthand", "secondhand", "read", "assumed"])
          .optional()
          .describe("How reliable is this knowledge?"),
      },
    },
    async ({ text, context, project, topics, source_type }) => {
      const { id } = capture(db, text, { context, project, topics, source_type });
      return {
        content: [{ type: "text", text: `Captured thought #${id}. Embedding queued.` }],
      };
    },
  );

  // ─── recent_thoughts ────────────────────────────────────────────────────────

  server.registerTool(
    "recent_thoughts",
    {
      title: "Recent Thoughts",
      description: "Browse recently captured thoughts, optionally filtered by context.",
      inputSchema: {
        context: z.string().optional(),
        limit: z.number().int().positive().optional().default(10),
      },
    },
    async ({ context, limit }) => {
      const results = recent(db, { context, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  // ─── surface_patterns ───────────────────────────────────────────────────────

  server.registerTool(
    "surface_patterns",
    {
      title: "Surface Patterns",
      description:
        "Detect recurring patterns in the knowledge base: topic spikes, cross-context clusters, recurring unsolved items, and dormant high-value knowledge.",
      inputSchema: {},
    },
    async () => {
      const patterns = await detectPatterns(db);
      return {
        content: [{ type: "text", text: JSON.stringify(patterns, null, 2) }],
      };
    },
  );

  // ─── weekly_digest ──────────────────────────────────────────────────────────

  server.registerTool(
    "weekly_digest",
    {
      title: "Weekly Digest",
      description:
        "Generate a Claude-powered weekly digest summarizing patterns and surfacing cross-context connections. Requires ANTHROPIC_API_KEY.",
      inputSchema: {},
    },
    async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        return {
          content: [{ type: "text", text: "Error: ANTHROPIC_API_KEY not set." }],
          isError: true,
        };
      }
      const digest = await generateDigest(db);
      return {
        content: [{ type: "text", text: digest }],
      };
    },
  );

  // ─── review_queue ───────────────────────────────────────────────────────────

  server.registerTool(
    "review_queue",
    {
      title: "Review Queue",
      description:
        "Return thoughts that need review: disputed, volatile, versioned-but-active, dead knowledge, or high-hit medium confidence.",
      inputSchema: {
        limit: z.number().int().positive().optional().default(10),
      },
    },
    async ({ limit }) => {
      const queue = getReviewQueue(db, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(queue, null, 2) }],
      };
    },
  );

  // ─── confirm_thought ────────────────────────────────────────────────────────

  server.registerTool(
    "confirm_thought",
    {
      title: "Confirm Thought",
      description: "Mark a thought as confirmed (high confidence).",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const ok = confirm(db, id);
      return {
        content: [{ type: "text", text: ok ? `#${id} confirmed.` : `#${id} not found.` }],
      };
    },
  );

  // ─── dispute_thought ────────────────────────────────────────────────────────

  server.registerTool(
    "dispute_thought",
    {
      title: "Dispute Thought",
      description: "Mark a thought as disputed (low confidence).",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const ok = dispute(db, id);
      return {
        content: [{ type: "text", text: ok ? `#${id} disputed.` : `#${id} not found.` }],
      };
    },
  );

  // ─── list_contexts ──────────────────────────────────────────────────────────

  server.registerTool(
    "list_contexts",
    {
      title: "List Contexts",
      description: "List available contexts configured in the brain.",
      inputSchema: {},
    },
    async () => {
      const contexts = getContexts(db);
      return {
        content: [{ type: "text", text: JSON.stringify(contexts, null, 2) }],
      };
    },
  );
}
