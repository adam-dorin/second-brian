// ─── Text Analysis ────────────────────────────────────────────────────────────

const VERSION_RE = /godot\s*\d|react\s*\d+|node\s*\d+|python\s*\d+|vue\s*\d+|angular\s*\d+|v\d+\.\d+/i;
const VOLATILE_RE = /\b(said|mentioned|told me|deadline|sprint|currently|right now|this week|this month|our process|the plan is|we decided|they want)\b/i;

export function detectVersionRef(text) {
  const match = text.match(VERSION_RE);
  return match ? match[0].toLowerCase().replace(/\s+/, "") : null;
}

export function detectVolatile(text) {
  return VOLATILE_RE.test(text);
}

// ─── Initial Quality Inference ────────────────────────────────────────────────

/**
 * Derive starting quality signals from text and optional user hints.
 * @param {string} text
 * @param {{ source_type?: string }} hints
 */
export function inferInitialQuality(text, hints = {}) {
  const source_type = hints.source_type ?? "firsthand";
  const versionRef = detectVersionRef(text);
  const isVolatile = detectVolatile(text);

  let staleness = "stable";
  if (versionRef) staleness = "versioned";
  else if (isVolatile) staleness = "volatile";

  return {
    confidence: source_type === "secondhand" ? "low" : "medium",
    source_type,
    staleness,
    version_ref: versionRef,
  };
}

// ─── Warning Generation ───────────────────────────────────────────────────────

/**
 * Returns a warning string for a thought, or null if clean.
 * @param {{ confidence: string, staleness: string, version_ref?: string, reviewed_at?: string, source_type?: string }} entry
 */
export function getWarning(entry) {
  if (entry.confidence === "low") {
    return `low confidence (${entry.source_type ?? "unknown source"})`;
  }
  if (entry.staleness === "versioned" && entry.version_ref) {
    return `versioned — was true for ${entry.version_ref}`;
  }
  if (entry.staleness === "volatile") {
    const monthsOld = monthsSince(entry.reviewed_at ?? entry.created_at);
    if (monthsOld > 3) {
      return `volatile — last reviewed ${Math.round(monthsOld)} months ago`;
    }
  }
  return null;
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function monthsSince(isoDate) {
  if (!isoDate) return Infinity;
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.44);
}

export function nDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

export function parseJSON(val, fallback = []) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}
