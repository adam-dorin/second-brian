#!/usr/bin/env node
import { getDb, getContexts, addContext, removeContext } from "./db.js";
import { startEmbedWorker, embedPending } from "./embed.js";
import {
  capture,
  search,
  recent,
  byProject,
  byContext,
  confirm,
  dispute,
  markReviewed,
  getThought,
  getReviewQueue,
  detectPatterns,
  generateDigest,
} from "./core.js";

// ─── Formatting ───────────────────────────────────────────────────────────────

const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const CYAN = (s) => `\x1b[36m${s}\x1b[0m`;

const CONFIDENCE_COLOR = { high: GREEN, medium: (s) => s, low: YELLOW };
const CONFIDENCE_SYMBOL = { high: "●", medium: "◐", low: "○" };

function printThought(t, { showScore = false } = {}) {
  const badge = `#${t.id}`;
  const ctx = t.context ? `[${t.context}]` : "[—]";
  const conf = (CONFIDENCE_COLOR[t.confidence] ?? ((s) => s))(
    `${CONFIDENCE_SYMBOL[t.confidence] ?? "?"} ${t.confidence}`,
  );
  const hits = t.hit_count > 0 ? DIM(`${t.hit_count} hit${t.hit_count !== 1 ? "s" : ""}`) : "";
  const score = showScore && t.scored_distance != null ? DIM(`dist:${t.scored_distance.toFixed(3)}`) : "";

  const meta = [ctx, conf, hits, score].filter(Boolean).join(" · ");
  console.log(`  ${BOLD(badge)}  ${meta}`);
  console.log(`  ${t.text}`);

  if (t.topics?.length) console.log(`  ${DIM("tags: " + t.topics.join(", "))}`);
  if (t.project) console.log(`  ${DIM("project: " + t.project)}`);
  if (t.warning) console.log(`  ${YELLOW("⚠  " + t.warning)}`);
  console.log(`  ${DIM("─".repeat(52))}`);
}

function printPatterns(patterns) {
  if (patterns.length === 0) {
    console.log(DIM("  No patterns detected yet. Keep capturing!"));
    return;
  }

  const byType = {};
  for (const p of patterns) {
    (byType[p.type] = byType[p.type] ?? []).push(p);
  }

  const labels = {
    topic_spike: CYAN("Topic Spikes"),
    cross_context: CYAN("Cross-Context Clusters"),
    recurring_unsolved: YELLOW("Recurring Unsolved"),
    dormant: DIM("Dormant High-Value"),
  };

  for (const [type, items] of Object.entries(byType)) {
    console.log(`\n  ${BOLD(labels[type] ?? type)}`);
    for (const item of items) {
      console.log(`    ${item.message}`);
      if (item.anchor) console.log(`    ${DIM("→ " + item.anchor)}`);
      if (item.thought) console.log(`    ${DIM("→ " + item.thought)}`);
    }
  }
}

// ─── Arg Parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }
  return { flags, positional };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const USAGE = `
${BOLD("brain")} — local-first second brain

${BOLD("Capture")}
  brain add <text> [--context <ctx>] [--project <name>] [--topics a,b,c]
                   [--source secondhand|read|assumed]

${BOLD("Search")}
  brain search <query> [--context <ctx>] [--project <name>] [--limit N]

${BOLD("Browse")}
  brain recent [--context <ctx>] [--limit N]
  brain project <name>
  brain context <name>

${BOLD("Quality")}
  brain review
  brain confirm <id>
  brain dispute <id>

${BOLD("Patterns")}
  brain patterns
  brain digest

${BOLD("Contexts")}
  brain contexts
  brain contexts add <name> [description]
  brain contexts remove <name>

${BOLD("Other")}
  brain get <id>
  brain embed          run the embed worker once (drain queue)
`;

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const [cmd, ...rest] = positional;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const db = getDb();

  // ── add ──────────────────────────────────────────────────────────────────

  if (cmd === "add") {
    const text = rest.join(" ");
    if (!text) { console.error("Usage: brain add <text>"); process.exit(1); }

    const topics = flags.topics ? flags.topics.split(",").map((t) => t.trim()) : [];
    const hints = {
      context: flags.context,
      project: flags.project,
      topics,
      source_type: flags.source,
    };

    const { id } = capture(db, text, hints);
    console.log(GREEN(`  ✓ Captured #${id}`));
    startEmbedWorker(db);
    // Give the worker a moment to start before exiting
    await new Promise((r) => setTimeout(r, 100));
    process.exit(0);
  }

  // ── search ───────────────────────────────────────────────────────────────

  if (cmd === "search") {
    const query = rest.join(" ");
    if (!query) { console.error("Usage: brain search <query>"); process.exit(1); }

    const results = await search(db, query, {
      context: flags.context,
      project: flags.project,
      limit: flags.limit ? Number(flags.limit) : 10,
    });

    if (results.length === 0) {
      console.log(DIM("  No results found."));
    } else {
      console.log(`\n  ${BOLD(`Results for "${query}"`)}\n`);
      for (const t of results) printThought(t, { showScore: true });
    }
    process.exit(0);
  }

  // ── recent ───────────────────────────────────────────────────────────────

  if (cmd === "recent") {
    const results = recent(db, {
      context: flags.context,
      limit: flags.limit ? Number(flags.limit) : 10,
    });
    console.log(`\n  ${BOLD("Recent thoughts")}\n`);
    if (results.length === 0) console.log(DIM("  Nothing yet."));
    else for (const t of results) printThought(t);
    process.exit(0);
  }

  // ── project ──────────────────────────────────────────────────────────────

  if (cmd === "project") {
    const name = rest[0];
    if (!name) { console.error("Usage: brain project <name>"); process.exit(1); }
    const results = byProject(db, name, flags.limit ? Number(flags.limit) : 20);
    console.log(`\n  ${BOLD(`Project: ${name}`)}\n`);
    if (results.length === 0) console.log(DIM("  Nothing found."));
    else for (const t of results) printThought(t);
    process.exit(0);
  }

  // ── context ──────────────────────────────────────────────────────────────

  if (cmd === "context") {
    const name = rest[0];
    if (!name) { console.error("Usage: brain context <name>"); process.exit(1); }
    const results = byContext(db, name, flags.limit ? Number(flags.limit) : 20);
    console.log(`\n  ${BOLD(`Context: ${name}`)}\n`);
    if (results.length === 0) console.log(DIM("  Nothing found."));
    else for (const t of results) printThought(t);
    process.exit(0);
  }

  // ── review ───────────────────────────────────────────────────────────────

  if (cmd === "review") {
    const queue = getReviewQueue(db, 10);
    console.log(`\n  ${BOLD("Review Queue")}\n`);
    if (queue.length === 0) { console.log(GREEN("  ✓ Nothing to review.")); }
    else for (const t of queue) printThought(t);
    process.exit(0);
  }

  // ── confirm ──────────────────────────────────────────────────────────────

  if (cmd === "confirm") {
    const id = Number(rest[0]);
    if (!id) { console.error("Usage: brain confirm <id>"); process.exit(1); }
    const ok = confirm(db, id);
    if (ok) { console.log(GREEN(`  ✓ #${id} confirmed as high confidence`)); markReviewed(db, id); }
    else console.log(RED(`  ✗ #${id} not found`));
    process.exit(0);
  }

  // ── dispute ──────────────────────────────────────────────────────────────

  if (cmd === "dispute") {
    const id = Number(rest[0]);
    if (!id) { console.error("Usage: brain dispute <id>"); process.exit(1); }
    const ok = dispute(db, id);
    if (ok) console.log(YELLOW(`  ⚠ #${id} marked as low confidence`));
    else console.log(RED(`  ✗ #${id} not found`));
    process.exit(0);
  }

  // ── get ───────────────────────────────────────────────────────────────────

  if (cmd === "get") {
    const id = Number(rest[0]);
    if (!id) { console.error("Usage: brain get <id>"); process.exit(1); }
    const t = getThought(db, id);
    if (!t) console.log(RED(`  ✗ #${id} not found`));
    else { console.log(); printThought(t); }
    process.exit(0);
  }

  // ── patterns ─────────────────────────────────────────────────────────────

  if (cmd === "patterns") {
    console.log(`\n  ${BOLD("Patterns")}\n`);
    const patterns = await detectPatterns(db);
    printPatterns(patterns);
    console.log();
    process.exit(0);
  }

  // ── digest ───────────────────────────────────────────────────────────────

  if (cmd === "digest") {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(RED("  ✗ ANTHROPIC_API_KEY not set. Add it to your .env file."));
      process.exit(1);
    }
    console.log(DIM("  Generating digest…"));
    const digest = await generateDigest(db);
    console.log(`\n${BOLD("  Weekly Digest")}\n`);
    console.log(digest.split("\n").map((l) => `  ${l}`).join("\n"));
    console.log();
    process.exit(0);
  }

  // ── contexts ─────────────────────────────────────────────────────────────

  if (cmd === "contexts") {
    const sub = rest[0];

    if (!sub) {
      const list = getContexts(db);
      console.log(`\n  ${BOLD("Contexts")}\n`);
      for (const c of list) {
        console.log(`  ${BOLD(c.name)}  ${DIM(c.description ?? "")}`);
      }
      console.log();
      process.exit(0);
    }

    if (sub === "add") {
      const name = rest[1];
      const description = rest.slice(2).join(" ") || null;
      if (!name) { console.error("Usage: brain contexts add <name> [description]"); process.exit(1); }
      addContext(db, name, description);
      console.log(GREEN(`  ✓ Context "${name}" added`));
      process.exit(0);
    }

    if (sub === "remove") {
      const name = rest[1];
      if (!name) { console.error("Usage: brain contexts remove <name>"); process.exit(1); }
      removeContext(db, name);
      console.log(YELLOW(`  ✓ Context "${name}" removed`));
      process.exit(0);
    }
  }

  // ── embed ─────────────────────────────────────────────────────────────────

  if (cmd === "embed") {
    console.log(DIM("  Running embed worker…"));
    const count = await embedPending(db, 100);
    console.log(GREEN(`  ✓ Embedded ${count} thought(s)`));
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}\nRun "brain help" for usage.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(RED(`  ✗ ${err.message}`));
  process.exit(1);
});
