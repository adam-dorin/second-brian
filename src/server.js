import { randomUUID } from "crypto";
import Fastify from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getDb, getContexts, addContext, removeContext } from "./db.js";
import { startEmbedWorker, embedPending } from "./embed.js";
import { registerTools } from "./tools.js";
import {
  capture,
  search,
  recent,
  confirm,
  dispute,
  getThought,
  updateThought,
  getReviewQueue,
  detectPatterns,
  generateDigest,
} from "./core.js";

const db = getDb();
startEmbedWorker(db);

const app = Fastify({ logger: true });

// ─── Auth ─────────────────────────────────────────────────────────────────────
// All routes require Authorization: Bearer <MCP_SECRET> when MCP_SECRET is set.
// If unset, the server starts unauthenticated with a warning — fine for localhost,
// not safe for public exposure.

const MCP_SECRET = process.env.MCP_SECRET;

if (MCP_SECRET) {
  app.addHook("onRequest", async (req, reply) => {
    const auth = req.headers["authorization"];
    if (!auth || auth !== `Bearer ${MCP_SECRET}`) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
} else {
  console.warn(
    "\x1b[33m[warn] MCP_SECRET not set — server is running without authentication.\n" +
    "       Set MCP_SECRET in .env before exposing this server publicly.\x1b[0m",
  );
}

// ─── MCP over HTTP ────────────────────────────────────────────────────────────
// One McpServer+transport pair per session. Sessions are keyed by Mcp-Session-Id
// and swept after 10 minutes of inactivity — covers clients (like claude -p) that
// exit without sending DELETE.

const SESSION_TTL_MS = 10 * 60 * 1000;
const mcpSessions = new Map(); // sessionId -> { transport, lastUsed }

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of mcpSessions) {
    if (session.lastUsed < cutoff) {
      session.transport.close?.();
      mcpSessions.delete(id);
    }
  }
}, 60 * 1000);

async function createMcpSession() {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  const server = new McpServer({ name: "brain", version: "1.0.0" });
  registerTools(server, db);
  transport.onclose = () => {
    if (transport.sessionId) mcpSessions.delete(transport.sessionId);
  };
  await server.connect(transport);
  return transport;
}

app.post("/mcp", async (req, reply) => {
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && mcpSessions.has(sessionId)) {
    const session = mcpSessions.get(sessionId);
    session.lastUsed = Date.now();
    await session.transport.handleRequest(req.raw, reply.raw, req.body);
    return;
  }

  const transport = await createMcpSession();
  await transport.handleRequest(req.raw, reply.raw, req.body);
  if (transport.sessionId) {
    mcpSessions.set(transport.sessionId, { transport, lastUsed: Date.now() });
  }
});

app.get("/mcp", async (req, reply) => {
  const session = mcpSessions.get(req.headers["mcp-session-id"]);
  if (!session) { reply.code(404).send(); return; }
  session.lastUsed = Date.now();
  await session.transport.handleRequest(req.raw, reply.raw);
});

app.delete("/mcp", async (req, reply) => {
  const sessionId = req.headers["mcp-session-id"];
  const session = mcpSessions.get(sessionId);
  if (!session) { reply.code(404).send(); return; }
  await session.transport.handleRequest(req.raw, reply.raw);
  mcpSessions.delete(sessionId);
});

// ─── Thoughts ─────────────────────────────────────────────────────────────────

app.post("/thoughts", async (req, reply) => {
  const { text, context, project, topics, source_type } = req.body ?? {};
  if (!text || typeof text !== "string") {
    return reply.code(400).send({ error: "text is required" });
  }
  const { id } = capture(db, text, { context, project, topics, source_type });
  const thought = getThought(db, id);
  return reply.code(201).send(thought);
});

app.get("/thoughts", async (req) => {
  const { context, project, limit } = req.query;
  return recent(db, { context, project, limit: limit ? Number(limit) : 10 });
});

app.get("/thoughts/search", async (req, reply) => {
  const { q, context, project, limit } = req.query;
  if (!q) return reply.code(400).send({ error: "q is required" });
  return search(db, q, { context, project, limit: limit ? Number(limit) : 10 });
});

app.get("/thoughts/review", async () => {
  return getReviewQueue(db, 10);
});

app.get("/thoughts/:id", async (req, reply) => {
  const id = Number(req.params.id);
  const thought = getThought(db, id);
  if (!thought) return reply.code(404).send({ error: `#${id} not found` });
  return thought;
});

app.patch("/thoughts/:id", async (req, reply) => {
  const id = Number(req.params.id);
  const { text, context, project, topics, source_type, confidence } = req.body ?? {};

  const fields = {};
  if (text !== undefined) {
    if (typeof text !== "string" || !text.trim())
      return reply.code(400).send({ error: "text must be a non-empty string" });
    fields.text = text.trim();
  }
  if (context !== undefined) fields.context = context;
  if (project !== undefined) fields.project = project;
  if (topics !== undefined) {
    if (!Array.isArray(topics))
      return reply.code(400).send({ error: "topics must be an array" });
    fields.topics = topics;
  }
  if (source_type !== undefined) fields.source_type = source_type;
  if (confidence !== undefined) {
    if (!["high", "medium", "low"].includes(confidence))
      return reply.code(400).send({ error: "confidence must be high|medium|low" });
    fields.confidence = confidence;
  }

  if (Object.keys(fields).length === 0) {
    return reply.code(400).send({ error: "No valid fields provided" });
  }

  const ok = updateThought(db, id, fields);
  if (!ok) return reply.code(404).send({ error: `#${id} not found` });

  if (fields.text) startEmbedWorker(db);

  return getThought(db, id);
});

app.patch("/thoughts/:id/confirm", async (req, reply) => {
  const id = Number(req.params.id);
  const ok = confirm(db, id);
  if (!ok) return reply.code(404).send({ error: `#${id} not found` });
  return getThought(db, id);
});

app.patch("/thoughts/:id/dispute", async (req, reply) => {
  const id = Number(req.params.id);
  const ok = dispute(db, id);
  if (!ok) return reply.code(404).send({ error: `#${id} not found` });
  return getThought(db, id);
});

// ─── Patterns & Digest ────────────────────────────────────────────────────────

app.get("/patterns", async () => {
  return detectPatterns(db);
});

app.get("/digest", async (req, reply) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return reply.code(401).send({ error: "ANTHROPIC_API_KEY not set" });
  }
  const digest = await generateDigest(db);
  return { digest };
});

// ─── Contexts ─────────────────────────────────────────────────────────────────

app.get("/contexts", async () => {
  return getContexts(db);
});

app.post("/contexts", async (req, reply) => {
  const { name, description } = req.body ?? {};
  if (!name || typeof name !== "string") {
    return reply.code(400).send({ error: "name is required" });
  }
  addContext(db, name, description ?? null);
  return reply.code(201).send({ name, description: description ?? null });
});

app.delete("/contexts/:name", async (req, reply) => {
  removeContext(db, req.params.name);
  return reply.code(204).send();
});

// ─── Embed ────────────────────────────────────────────────────────────────────

app.post("/embed", async () => {
  const count = await embedPending(db, 100);
  return { embedded: count };
});

// ─── Start ────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
