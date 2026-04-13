import { pipeline } from "@xenova/transformers";

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let _extractor = null;
let _workerTimer = null;

// ─── Model ────────────────────────────────────────────────────────────────────

export async function getExtractor() {
  if (_extractor) return _extractor;
  _extractor = await pipeline("feature-extraction", MODEL);
  return _extractor;
}

/**
 * Embed a string into a Float32Array of 384 dimensions.
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
export async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}

// ─── Background Worker ────────────────────────────────────────────────────────

/**
 * Embed up to `batchSize` un-embedded thoughts and mark them done.
 * @param {import('better-sqlite3').Database} db
 * @param {number} batchSize
 */
export async function embedPending(db, batchSize = 10) {
  const pending = db
    .prepare("SELECT id, text FROM thoughts WHERE embedded = 0 LIMIT ?")
    .all(batchSize);

  for (const row of pending) {
    const vec = await embed(row.text);
    const result = db.prepare("INSERT INTO thoughts_vec (embedding) VALUES (?)").run(Buffer.from(vec.buffer));
    db.prepare("UPDATE thoughts SET embedded = 1, vec_rowid = ? WHERE id = ?").run(Number(result.lastInsertRowid), row.id);
  }

  return pending.length;
}

/**
 * Start a background interval that continuously drains the embed queue.
 * @param {import('better-sqlite3').Database} db
 * @param {number} intervalMs
 */
export function startEmbedWorker(db, intervalMs = 2000) {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => embedPending(db).catch(console.error), intervalMs);
  // Don't block process exit
  if (_workerTimer.unref) _workerTimer.unref();
}

export function stopEmbedWorker() {
  if (_workerTimer) {
    clearInterval(_workerTimer);
    _workerTimer = null;
  }
}
