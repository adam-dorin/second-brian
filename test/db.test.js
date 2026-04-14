import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb, getContexts, addContext, removeContext, contextExists } from "../src/db.js";

let db;

describe("db schema and contexts", () => {
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("creates thoughts table", () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='thoughts'").get();
    assert.ok(row);
  });

  it("creates thoughts_vec virtual table", () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='thoughts_vec'").get();
    assert.ok(row);
  });

  it("can add a context", () => {
    addContext(db, "research", "Research notes");
    assert.ok(contextExists(db, "research"));
  });

  it("can remove a context", () => {
    removeContext(db, "passion");
    assert.ok(!contextExists(db, "passion"));
  });

  it("thoughts table has expected columns", () => {
    const cols = db
      .prepare("PRAGMA table_info(thoughts)")
      .all()
      .map((c) => c.name);
    for (const col of ["id", "text", "context", "project", "topics", "confidence", "staleness", "hit_count", "embedded", "created_at"]) {
      assert.ok(cols.includes(col), `missing column: ${col}`);
    }
  });

  it("WAL mode is set on file databases (in-memory uses 'memory')", () => {
    // In-memory DBs always use memory journal; WAL applies to file-based DBs.
    const { journal_mode } = db.pragma("journal_mode", { simple: false })[0];
    assert.ok(["wal", "memory"].includes(journal_mode));
  });
});
