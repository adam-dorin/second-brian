import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { openDb, addContext } from "../src/db.js";
import { capture, recent, byProject, byContext, confirm, dispute, getThought, updateThought, getReviewQueue, detectPatterns } from "../src/core.js";

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
    addContext(db, "gamedev");
    addContext(db, "work");
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
    addContext(db, "work");
    addContext(db, "gamedev");
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
    db.prepare("UPDATE thoughts SET hit_count = 4, embedded = 1 WHERE id = ?").run(id);

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

describe("updateThought", () => {
  beforeEach(() => {
    db = openDb(":memory:");
    addContext(db, "work");
    addContext(db, "personal");
  });

  it("updates text and returns true", () => {
    const { id } = capture(db, "original text");
    const ok = updateThought(db, id, { text: "revised text" });
    assert.equal(ok, true);
    assert.equal(getThought(db, id).text, "revised text");
  });

  it("invalidates embedding when text changes", () => {
    const { id } = capture(db, "some thought");
    db.prepare("UPDATE thoughts SET embedded = 1 WHERE id = ?").run(id);
    updateThought(db, id, { text: "updated thought" });
    const row = db.prepare("SELECT embedded, vec_rowid FROM thoughts WHERE id = ?").get(id);
    assert.equal(row.embedded, 0);
    assert.equal(row.vec_rowid, null);
  });

  it("does not invalidate embedding when text is not changed", () => {
    const { id } = capture(db, "stable thought");
    db.prepare("UPDATE thoughts SET embedded = 1 WHERE id = ?").run(id);
    updateThought(db, id, { confidence: "high" });
    const row = db.prepare("SELECT embedded FROM thoughts WHERE id = ?").get(id);
    assert.equal(row.embedded, 1);
  });

  it("updates context", () => {
    const { id } = capture(db, "a note", { context: "work" });
    updateThought(db, id, { context: "personal" });
    assert.equal(getThought(db, id).context, "personal");
  });

  it("clears context when set to null", () => {
    const { id } = capture(db, "a note", { context: "work" });
    updateThought(db, id, { context: null });
    assert.equal(getThought(db, id).context, null);
  });

  it("updates project", () => {
    const { id } = capture(db, "a note", { project: "alpha" });
    updateThought(db, id, { project: "beta" });
    assert.equal(getThought(db, id).project, "beta");
  });

  it("updates topics", () => {
    const { id } = capture(db, "a note", { topics: ["a"] });
    updateThought(db, id, { topics: ["x", "y"] });
    assert.deepEqual(getThought(db, id).topics, ["x", "y"]);
  });

  it("updates confidence", () => {
    const { id } = capture(db, "a claim");
    updateThought(db, id, { confidence: "high" });
    assert.equal(getThought(db, id).confidence, "high");
  });

  it("updates source_type", () => {
    const { id } = capture(db, "heard something");
    updateThought(db, id, { source_type: "secondhand" });
    assert.equal(getThought(db, id).source_type, "secondhand");
  });

  it("partial update leaves other fields intact", () => {
    const { id } = capture(db, "multi-field note", {
      context: "work",
      project: "alpha",
      topics: ["foo"],
    });
    updateThought(db, id, { confidence: "high" });
    const t = getThought(db, id);
    assert.equal(t.context, "work");
    assert.equal(t.project, "alpha");
    assert.deepEqual(t.topics, ["foo"]);
    assert.equal(t.confidence, "high");
  });

  it("empty fields object is a no-op and returns true", () => {
    const { id } = capture(db, "unchanged note");
    const ok = updateThought(db, id, {});
    assert.equal(ok, true);
    assert.equal(getThought(db, id).text, "unchanged note");
  });

  it("returns false for unknown id", () => {
    const ok = updateThought(db, 99999, { text: "ghost" });
    assert.equal(ok, false);
  });
});
