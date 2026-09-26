import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createSqliteBinding } from "./sqlite-binding.mjs";

test("SQLite binding supports Drizzle, rollback, and persistence across restarts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "crimap-db-"));
  const file = join(directory, "events.sqlite");
  let binding = createSqliteBinding(file);
  try {
    binding.exec("CREATE TABLE events(id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE)");
    const events = sqliteTable("events", { id: integer("id").primaryKey(), title: text("title").notNull() });
    const db = drizzle(binding);
    await db.insert(events).values({ id: 1, title: "Будапешт" });
    assert.deepEqual(await db.select().from(events), [{ id: 1, title: "Будапешт" }]);
    assert.equal(await binding.prepare("SELECT title FROM events WHERE id=?").bind(1).first("title"), "Будапешт");
    assert.equal(await binding.prepare("SELECT * FROM events WHERE id=99").first(), null);
    await assert.rejects(binding.batch([
      binding.prepare("INSERT INTO events VALUES (?, ?)").bind(2, "Second"),
      binding.prepare("INSERT INTO events VALUES (?, ?)").bind(3, "Будапешт"),
    ]));
    assert.equal(await binding.prepare("SELECT count(*) AS n FROM events").first("n"), 1);
    binding.close();
    binding = createSqliteBinding(file);
    assert.deepEqual(await binding.prepare("SELECT id,title FROM events").raw(), [[1, "Будапешт"]]);
  } finally {
    binding.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
