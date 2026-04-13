# Second Brian

Local-first, bilingual (EN/RO) second brain. Semantic search over your notes, thoughts, and knowledge — runs entirely on your machine.

**Stack:** Node.js · SQLite · sqlite-vec · transformers.js (multilingual embeddings) · Fastify · MCP

---

## Setup

```bash
npm install
npm link          # makes `brain` available globally
cp .env.example .env
```

On first use, the embedding model (`paraphrase-multilingual-MiniLM-L12-v2`, ~420MB) downloads automatically and is cached locally.

---

## Environment

```
# Required only for `brain digest` and the MCP `weekly_digest` tool
ANTHROPIC_API_KEY=sk-ant-...

# Optional overrides
# BRAIN_DB_PATH=/path/to/brain.sqlite
# PORT=3000
# HOST=127.0.0.1

# Set to require Authorization: Bearer <secret> on all HTTP routes
# Leave unset for localhost-only use
# MCP_SECRET=your-secret-here
```

---

## CLI

### Capture

```bash
brain add "figured out z-fighting — adjust near clip plane in godot"
brain add "standup: blocked on auth migration" --context work
brain add "idee buna pentru sistem de inventar" --context gamedev --project dungeon-crawler
brain add "John mentioned we're moving to microservices" --context work --source secondhand
brain add "react 18 concurrent mode removes tearing" --topics react,concurrency
```

Capture is instant. Embedding runs in the background within a few seconds.

### Search

```bash
brain search "godot shader optimization"
brain search "state management" --context work
brain search "render loop" --project dungeon-crawler --limit 5
```

Results are ranked by semantic similarity, with a bias toward the active context. Quality warnings are shown inline.

### Browse

```bash
brain recent
brain recent --context gamedev --limit 20
brain project dungeon-crawler
brain context work
brain get 42
```

### Quality

```bash
brain review           # shows disputed, volatile, versioned, and dead knowledge
brain confirm 42       # mark as high confidence
brain dispute 42       # mark as low confidence
```

### Patterns

```bash
brain patterns         # topic spikes, cross-context clusters, recurring unsolved, dormant
brain digest           # Claude-powered weekly summary (requires ANTHROPIC_API_KEY)
```

### Contexts

```bash
brain contexts                        # list all
brain contexts add research "Papers and reading"
brain contexts remove research
```

### Other

```bash
brain embed            # manually drain the embed queue
```

---

## MCP Server

For use with Claude Desktop, Claude Code, or any MCP-compatible agent.

```bash
npm run setup   # prints tailored setup instructions for this machine
```

### Available tools

| Tool | Description |
|---|---|
| `search_brain` | Semantic search with optional context bias |
| `capture_thought` | Save a thought with metadata |
| `recent_thoughts` | Browse recent captures |
| `surface_patterns` | Detect topic spikes, clusters, dormant knowledge |
| `weekly_digest` | Claude-powered digest (requires API key) |
| `review_queue` | Thoughts that need review |
| `confirm_thought` | Mark as high confidence |
| `dispute_thought` | Mark as low confidence |
| `list_contexts` | List configured contexts |

---

## REST API

Start the server:

```bash
npm start              # http://127.0.0.1:3000
```

### Thoughts

| Method | Path | Description |
|---|---|---|
| `POST` | `/thoughts` | Capture a thought |
| `GET` | `/thoughts` | Recent thoughts (`?context=&project=&limit=`) |
| `GET` | `/thoughts/search` | Semantic search (`?q=&context=&project=&limit=`) |
| `GET` | `/thoughts/review` | Review queue |
| `GET` | `/thoughts/:id` | Single thought by ID |
| `PATCH` | `/thoughts/:id/confirm` | Mark as high confidence |
| `PATCH` | `/thoughts/:id/dispute` | Mark as low confidence |

```bash
# capture
curl -X POST http://localhost:3000/thoughts \
  -H "Content-Type: application/json" \
  -d '{"text": "near clip plane trick for z-fighting", "context": "gamedev", "topics": ["godot","rendering"]}'

# search
curl "http://localhost:3000/thoughts/search?q=godot+shaders&context=gamedev"
```

### Patterns & Digest

| Method | Path | Description |
|---|---|---|
| `GET` | `/patterns` | Detect patterns in the knowledge base |
| `GET` | `/digest` | Claude-powered weekly digest (requires API key) |

### Contexts

| Method | Path | Description |
|---|---|---|
| `GET` | `/contexts` | List all contexts |
| `POST` | `/contexts` | Add a context (`{ name, description? }`) |
| `DELETE` | `/contexts/:name` | Remove a context |

### Other

| Method | Path | Description |
|---|---|---|
| `POST` | `/embed` | Drain the embed queue manually |

---

## Knowledge Quality

Every thought gets automatic quality signals at capture:

- **Confidence** — `high / medium / low`. Defaults to `medium`. Upgraded via usage or `brain confirm`.
- **Staleness** — `stable / versioned / volatile`. Auto-detected from text (e.g. "React 18", "John said", "this week").
- **Version ref** — extracted from text (e.g. `godot4`, `react18`, `node20`).

The review queue surfaces:
1. Disputed thoughts
2. Volatile thoughts not reviewed in 60+ days
3. Versioned thoughts still being actively looked up
4. Dead knowledge (0 hits, 180+ days old)
5. Medium-confidence thoughts with 10+ hits (promote or dismiss)

---

## Tests

```bash
npm test
```

Uses Node's built-in test runner — no external test framework.

---

## Project Structure

```
src/
  db.js        schema, migrations, contexts CRUD
  utils.js     detectVolatile, detectVersionRef, getWarning, inferInitialQuality
  embed.js     multilingual embedding model, background worker
  core.js      capture, search, recent, review, patterns, digest
  cli.js       CLI entry point (brain)
  server.js    Fastify REST API + MCP over HTTP
  mcp.js       MCP server (stdio)
  tools.js     MCP tool definitions (shared between mcp.js and server.js)
test/
  utils.test.js
  db.test.js
  core.test.js
setup-mcp.js   prints MCP setup instructions for this machine
brain.sqlite   local database (gitignored)
```
