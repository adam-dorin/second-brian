import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import {
  capture,
  recent,
  byProject,
  byContext,
  confirm,
  dispute,
  getThought,
  getReviewQueue,
  detectPatterns,
} from "../src/core.js";

// Mock embed so tests don't load the real model
import * as embedModule from "../src/embed.js";

function makeVec(seed = 0) {
  const arr = new Float32Array(384);
  arr[seed % 384] = 1.0;
  return arr;
}

let db;
let embedCallCount = 0;

describe("capture", () => {
  beforeEach(() => {
    db = openDb(":memory:");
    embedCallCount = 0;
  });

  it("inserts a thought and returns its id", () => {
    const { id } = capture(db, "fix z-fighting by adjusting near clip plane", {
      context: "gamedev",
      topics: ["godot", "rendering"],
    });
    assert.ok(id > 0);
  });

  it("detects language as en for English text", () => {
    capture(db, "JavaScript closures capture their enclosing scope", {});
    const row = db.prepare("SELECT lang FROM thoughts LIMIT 1").get();
    assert.equal(row.lang, "en");
  });

  it("stores topics as JSON array", () => {
    capture(db, "some note", { topics: ["alpha", "beta"] });
    const row = db.prepare("SELECT topics FROM thoughts LIMIT 1").get();
    assert.deepEqual(JSON.parse(row.topics), ["alpha", "beta"]);
  });

  it("infers versioned staleness from text", () => {
    capture(db, "In React 18 transitions are non-blocking", {});
    const row = db.prepare("SELECT staleness, version_ref FROM thoughts LIMIT 1").get();
    assert.equal(row.staleness, "versioned");
    assert.equal(row.version_ref, "react18");
  });

  it("infers volatile from text", () => {
    capture(db, "John mentioned we should rewrite the auth module", {});
    const row = db.prepare("SELECT staleness FROM thoughts LIMIT 1").get();
    assert.equal(row.staleness, "volatile");
  });
});

describe("recent / byProject / byContext", () => {
  beforeEach(() => {
    db = openDb(":memory:");
    capture(db, "work note 1", { context: "work", project: "alpha" });
    capture(db, "work note 2", { context: "work", project: "alpha" });
    capture(db, "gamedev note", { context: "gamedev", project: "dungeon" });
  });

  it("recent returns all by default", () => {
    const results = recent(db, { limit: 10 });
    assert.equal(results.length, 3);
  });

  it("recent filters by context", () => {
    const results = recent(db, { context: "work" });
    assert.equal(results.length, 2);
  });

  it("byProject filters correctly", () => {
    const results = byProject(db, "alpha");
    assert.equal(results.length, 2);
  });

  it("byContext filters correctly", () => {
    const results = byContext(db, "gamedev");
    assert.equal(results.length, 1);
    assert.equal(results[0].context, "gamedev");
  });
});

describe("confirm / dispute / getThought", () => {
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("confirm sets confidence to high", () => {
    const { id } = capture(db, "a factual note");
    confirm(db, id);
    const t = getThought(db, id);
    assert.equal(t.confidence, "high");
    assert.ok(t.confirmed_at);
  });

  it("dispute sets confidence to low", () => {
    const { id } = capture(db, "a suspect claim");
    dispute(db, id);
    const t = getThought(db, id);
    assert.equal(t.confidence, "low");
    assert.ok(t.disputed_at);
  });

  it("confirm clears disputed_at", () => {
    const { id } = capture(db, "disputed then confirmed");
    dispute(db, id);
    confirm(db, id);
    const t = getThought(db, id);
    assert.equal(t.confidence, "high");
    assert.equal(t.disputed_at, null);
  });

  it("returns null for unknown id", () => {
    assert.equal(getThought(db, 99999), null);
  });

  it("confirm returns false for unknown id", () => {
    assert.equal(confirm(db, 99999), false);
  });
});

describe("getReviewQueue", () => {
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("includes disputed thoughts", () => {
    const { id } = capture(db, "a disputed claim");
    dispute(db, id);
    const queue = getReviewQueue(db);
    assert.ok(queue.some((t) => t.id === id));
  });

  it("excludes confirmed high-confidence stable thoughts", () => {
    const { id } = capture(db, "solid verified knowledge");
    confirm(db, id);
    // Manually ensure hit_count stays low
    const queue = getReviewQueue(db);
    assert.ok(!queue.some((t) => t.id === id));
  });
});

describe("detectPatterns", () => {
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("detects recurring unsolved (hit_count >= 3, not confirmed)", () => {
    const { id } = capture(db, "why does setState not update immediately");
    db.prepare(
      "UPDATE thoughts SET hit_count = 4, embedded = 1 WHERE id = ?",
    ).run(id);

    return detectPatterns(db).then((patterns) => {
      const found = patterns.some((p) => p.type === "recurring_unsolved" && p.id === id);
      assert.ok(found, "expected recurring_unsolved pattern");
    });
  });

  it("detects dormant high-value knowledge", () => {
    const { id } = capture(db, "near clip plane trick for z-fighting");
    db.prepare(
      `UPDATE thoughts SET
         hit_count = 6,
         confidence = 'high',
         last_hit = datetime('now', '-120 days'),
         embedded = 1
       WHERE id = ?`,
    ).run(id);

    return detectPatterns(db).then((patterns) => {
      const found = patterns.some((p) => p.type === "dormant" && p.id === id);
      assert.ok(found, "expected dormant pattern");
    });
  });
});
