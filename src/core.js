import { franc } from "franc";
import { embed, embedPending } from "./embed.js";
import { inferInitialQuality, getWarning, nDaysAgo, parseJSON } from "./utils.js";

// ─── Capture ──────────────────────────────────────────────────────────────────

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} text
 * @param {{ context?: string, project?: string, topics?: string[], source_type?: string }} hints
 * @returns {{ id: number }}
 */
export function capture(db, text, hints = {}) {
  const langCode = franc(text, { only: ["eng", "ron"] });
  const lang = langCode === "ron" ? "ro" : "en";

  const quality = inferInitialQuality(text, hints);

  const result = db
    .prepare(
      `INSERT INTO thoughts
        (text, context, project, topics, lang,
         confidence, source_type, staleness, version_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      text,
      hints.context ?? null,
      hints.project ?? null,
      JSON.stringify(hints.topics ?? []),
      lang,
      quality.confidence,
      quality.source_type,
      quality.staleness,
      quality.version_ref,
    );

  return { id: Number(result.lastInsertRowid) };
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} query
 * @param {{ context?: string, project?: string, limit?: number, boost?: number }} opts
 */
export async function search(db, query, opts = {}) {
  const { context = null, project = null, limit = 10, boost = 0.3 } = opts;

  let queryVec;
  try {
    queryVec = await embed(query);
  } catch (err) {
    throw Object.assign(new Error("Embedding model unavailable: " + err.message), { statusCode: 503 });
  }

  let sql = `
    SELECT t.*,
      CASE WHEN t.context = $context THEN v.distance - $boost
           ELSE v.distance
      END AS scored_distance
    FROM thoughts_vec v
    JOIN thoughts t ON t.vec_rowid = v.rowid
    WHERE v.embedding MATCH $queryVec
      AND k = $limit
      AND t.embedded = 1
  `;

  const params = { queryVec: Buffer.from(queryVec.buffer), context, boost, limit };

  if (project) {
    sql += " AND t.project = $project";
    params.project = project;
  }

  sql += " ORDER BY scored_distance";

  const rows = db.prepare(sql).all(params);

  // Record hits
  const updateHit = db.prepare(
    "UPDATE thoughts SET hit_count = hit_count + 1, last_hit = datetime('now') WHERE id = ?",
  );
  for (const row of rows) updateHit.run(row.id);

  return rows.map(formatThought);
}

// ─── Recent ───────────────────────────────────────────────────────────────────

export function recent(db, opts = {}) {
  const { context = null, project = null, limit = 10 } = opts;

  let sql = "SELECT * FROM thoughts WHERE 1=1";
  const params = [];

  if (context) { sql += " AND context = ?"; params.push(context); }
  if (project) { sql += " AND project = ?"; params.push(project); }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params).map(formatThought);
}

// ─── Browse by project / context ──────────────────────────────────────────────

export function byProject(db, project, limit = 20) {
  return db
    .prepare("SELECT * FROM thoughts WHERE project = ? ORDER BY created_at DESC LIMIT ?")
    .all(project, limit)
    .map(formatThought);
}

export function byContext(db, context, limit = 20) {
  return db
    .prepare("SELECT * FROM thoughts WHERE context = ? ORDER BY created_at DESC LIMIT ?")
    .all(context, limit)
    .map(formatThought);
}

// ─── Quality Actions ──────────────────────────────────────────────────────────

export function confirm(db, id) {
  const info = db
    .prepare(
      "UPDATE thoughts SET confirmed_at = datetime('now'), confidence = 'high', disputed_at = NULL WHERE id = ?",
    )
    .run(id);
  return info.changes > 0;
}

export function dispute(db, id) {
  const info = db
    .prepare(
      "UPDATE thoughts SET disputed_at = datetime('now'), confidence = 'low' WHERE id = ?",
    )
    .run(id);
  return info.changes > 0;
}

export function markReviewed(db, id) {
  db.prepare("UPDATE thoughts SET reviewed_at = datetime('now') WHERE id = ?").run(id);
}

export function getThought(db, id) {
  const row = db.prepare("SELECT * FROM thoughts WHERE id = ?").get(id);
  return row ? formatThought(row) : null;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Partially update a thought. Only provided fields are changed.
 * If `text` changes the embedding is invalidated and re-queued.
 * staleness is excluded — it is always re-inferred from the new text at capture.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{ text?: string, context?: string, project?: string,
 *           topics?: string[], source_type?: string, confidence?: string }} fields
 * @returns {boolean} false if not found
 */
export function updateThought(db, id, fields) {
  const allowed = ["text", "context", "project", "source_type", "confidence"];
  const setClauses = [];
  const values = [];

  for (const key of allowed) {
    if (key in fields) {
      setClauses.push(`${key} = ?`);
      values.push(fields[key] ?? null);
    }
  }

  if ("topics" in fields) {
    setClauses.push("topics = ?");
    values.push(JSON.stringify(fields.topics ?? []));
  }

  if (setClauses.length === 0) return getThought(db, id) !== null;

  // Text changed — invalidate embedding so it gets re-queued
  if ("text" in fields) {
    setClauses.push("embedded = 0");
    setClauses.push("vec_rowid = NULL");
  }

  values.push(id);
  const info = db
    .prepare(`UPDATE thoughts SET ${setClauses.join(", ")} WHERE id = ?`)
    .run(...values);
  return info.changes > 0;
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

export function getReviewQueue(db, limit = 10) {
  return db
    .prepare(
      `SELECT *,
        CASE
          WHEN disputed_at IS NOT NULL AND confirmed_at IS NULL THEN 1
          WHEN staleness = 'volatile'
           AND (reviewed_at IS NULL OR reviewed_at < datetime('now', '-60 days')) THEN 2
          WHEN staleness = 'versioned'
           AND last_hit > datetime('now', '-30 days') THEN 3
          WHEN hit_count = 0
           AND created_at < datetime('now', '-180 days') THEN 4
          WHEN confidence = 'medium' AND hit_count > 10 THEN 5
          ELSE 99
        END AS review_priority
       FROM thoughts
       WHERE review_priority < 99
       ORDER BY review_priority, last_hit DESC
       LIMIT ?`,
    )
    .all(limit)
    .map(formatThought);
}

// ─── Pattern Detection ────────────────────────────────────────────────────────

export async function detectPatterns(db) {
  const patterns = [];

  // 1. Topic spikes
  const recentTopics = topicFrequency(db, nDaysAgo(14));
  const historicTopics = topicFrequency(db, nDaysAgo(90));
  const historicMap = new Map(historicTopics);

  for (const [topic, recentCount] of recentTopics) {
    const historicCount = historicMap.get(topic) ?? 0;
    const historicRate = historicCount / 90;
    const recentRate = recentCount / 14;
    if (recentRate > historicRate * 2 && recentCount >= 2) {
      patterns.push({
        type: "topic_spike",
        topic,
        message: `"${topic}" appearing ${(recentRate / (historicRate || 0.01)).toFixed(1)}x more than usual`,
      });
    }
  }

  // 2. Cross-context clusters
  const recentThoughts = db
    .prepare("SELECT * FROM thoughts WHERE created_at > ? AND embedded = 1")
    .all(nDaysAgo(30));

  for (const thought of recentThoughts) {
    const related = await findRelated(db, thought.id, { threshold: 0.6, limit: 10 });
    const contexts = [...new Set(related.map((r) => r.context).filter(Boolean))];
    if (contexts.length >= 2) {
      patterns.push({
        type: "cross_context",
        message: `Idea spans ${contexts.join(", ")}`,
        anchor: thought.text.slice(0, 100),
      });
    }
  }

  // 3. Recurring unsolved
  const recurringUnsolved = db
    .prepare(
      `SELECT * FROM thoughts
       WHERE confidence != 'high' AND hit_count >= 3 AND confirmed_at IS NULL
       ORDER BY hit_count DESC LIMIT 10`,
    )
    .all();
  for (const t of recurringUnsolved) {
    patterns.push({
      type: "recurring_unsolved",
      message: `Looked up ${t.hit_count}x but never confirmed`,
      thought: t.text.slice(0, 120),
      id: t.id,
    });
  }

  // 4. Dormant high-value
  const dormant = db
    .prepare(
      `SELECT * FROM thoughts
       WHERE hit_count >= 5
         AND last_hit < datetime('now', '-90 days')
         AND confidence = 'high'
       ORDER BY hit_count DESC LIMIT 10`,
    )
    .all();
  for (const t of dormant) {
    patterns.push({
      type: "dormant",
      message: `High-value knowledge untouched for 90+ days`,
      thought: t.text.slice(0, 120),
      id: t.id,
    });
  }

  return patterns;
}

// ─── Weekly Digest ────────────────────────────────────────────────────────────

/**
 * Generate a digest using Claude API. Requires ANTHROPIC_API_KEY in env.
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<string>}
 */
export async function generateDigest(db) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const patterns = await detectPatterns(db);

  const recentThoughts = db
    .prepare(
      "SELECT text, context FROM thoughts WHERE created_at > ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(nDaysAgo(7));

  if (recentThoughts.length === 0 && patterns.length === 0) {
    return "No activity in the last 7 days.";
  }

  const prompt = `Here are my captured thoughts from the last week:

${recentThoughts.map((t) => `[${t.context ?? "general"}] ${t.text}`).join("\n")}

Detected patterns:
${patterns.length > 0 ? patterns.map((p) => `- ${p.type}: ${p.message}`).join("\n") : "None detected."}

Give me:
1. The 2-3 most significant patterns worth paying attention to
2. Any cross-context connections I might be missing
3. One question I should be asking myself based on what keeps coming up

Be concise and direct. No filler.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system:
      "You are a reflective knowledge assistant. You help the user understand patterns in their own thinking. Be direct, insightful, and brief.",
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findRelated(db, id, { threshold = 0.6, limit = 10 } = {}) {
  const thought = db.prepare("SELECT vec_rowid FROM thoughts WHERE id = ?").get(Number(id));
  if (!thought?.vec_rowid) return [];
  const row = db.prepare("SELECT embedding FROM thoughts_vec WHERE rowid = ?").get(thought.vec_rowid);
  if (!row) return [];

  return db
    .prepare(
      `SELECT t.*, v.distance
       FROM thoughts_vec v
       JOIN thoughts t ON t.vec_rowid = v.rowid
       WHERE v.embedding MATCH ?
         AND k = ?
         AND v.rowid != ?
         AND v.distance <= ?
       ORDER BY v.distance`,
    )
    .all(row.embedding, limit, thought.vec_rowid, threshold)
    .map(formatThought);
}

function topicFrequency(db, since) {
  const rows = db
    .prepare("SELECT topics FROM thoughts WHERE created_at > ? AND topics IS NOT NULL")
    .all(since);

  const counts = new Map();
  for (const row of rows) {
    for (const topic of parseJSON(row.topics)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function formatThought(row) {
  return {
    ...row,
    topics: parseJSON(row.topics),
    people: parseJSON(row.people),
    action_items: parseJSON(row.action_items),
    warning: getWarning(row),
  };
}
