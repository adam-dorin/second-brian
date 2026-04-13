import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectVersionRef,
  detectVolatile,
  inferInitialQuality,
  getWarning,
  monthsSince,
  parseJSON,
} from "../src/utils.js";

describe("detectVersionRef", () => {
  it("detects godot version", () => {
    assert.equal(detectVersionRef("z-fighting in godot4"), "godot4");
  });

  it("detects react version", () => {
    assert.equal(detectVersionRef("upgrade to React 18 hooks"), "react18");
  });

  it("detects semver", () => {
    assert.equal(detectVersionRef("works in v2.1"), "v2.1");
  });

  it("returns null when no version", () => {
    assert.equal(detectVersionRef("just a regular note"), null);
  });
});

describe("detectVolatile", () => {
  it("detects volatile phrasing", () => {
    assert.ok(detectVolatile("John said we should refactor"));
    assert.ok(detectVolatile("deadline is this week"));
    assert.ok(detectVolatile("currently blocked on auth"));
  });

  it("returns false for stable text", () => {
    assert.ok(!detectVolatile("adjust near clip plane to fix z-fighting"));
  });
});

describe("inferInitialQuality", () => {
  it("infers versioned staleness when version ref detected", () => {
    const q = inferInitialQuality("use React 18 concurrent mode");
    assert.equal(q.staleness, "versioned");
    assert.equal(q.version_ref, "react18");
  });

  it("infers volatile staleness when volatile phrasing detected", () => {
    const q = inferInitialQuality("John mentioned we are moving to microservices");
    assert.equal(q.staleness, "volatile");
  });

  it("stable for plain notes", () => {
    const q = inferInitialQuality("shader uniform bindings must be set before draw");
    assert.equal(q.staleness, "stable");
    assert.equal(q.version_ref, null);
  });

  it("secondhand hint lowers confidence", () => {
    const q = inferInitialQuality("apparently pgvector is faster", { source_type: "secondhand" });
    assert.equal(q.confidence, "low");
  });

  it("default confidence is medium", () => {
    const q = inferInitialQuality("I solved the bug by clearing cache");
    assert.equal(q.confidence, "medium");
  });
});

describe("getWarning", () => {
  it("warns on low confidence", () => {
    const w = getWarning({ confidence: "low", staleness: "stable", source_type: "secondhand" });
    assert.ok(w.includes("low confidence"));
  });

  it("warns on versioned", () => {
    const w = getWarning({ confidence: "medium", staleness: "versioned", version_ref: "react17" });
    assert.ok(w.includes("react17"));
  });

  it("warns on stale volatile", () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString();
    const w = getWarning({
      confidence: "medium",
      staleness: "volatile",
      reviewed_at: oldDate,
    });
    assert.ok(w.includes("volatile"));
  });

  it("returns null for healthy entries", () => {
    const w = getWarning({ confidence: "high", staleness: "stable" });
    assert.equal(w, null);
  });
});

describe("monthsSince", () => {
  it("returns 0 for now", () => {
    const now = new Date().toISOString();
    assert.ok(monthsSince(now) < 0.01);
  });

  it("returns Infinity for null", () => {
    assert.equal(monthsSince(null), Infinity);
  });
});

describe("parseJSON", () => {
  it("parses valid JSON", () => {
    assert.deepEqual(parseJSON('["a","b"]'), ["a", "b"]);
  });

  it("returns fallback on invalid JSON", () => {
    assert.deepEqual(parseJSON("not json", []), []);
  });

  it("returns fallback for null", () => {
    assert.deepEqual(parseJSON(null, []), []);
  });
});
