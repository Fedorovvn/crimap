import { DatabaseSync } from "node:sqlite";

// Implements the D1 operations used by this app and Drizzle on native SQLite.
// The VPS owns its database; local Cloudflare previews keep their original binding.
export function createSqliteBinding(filename) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    execute() {
      const stmt = db.prepare(this.sql);
      if (stmt.columns().length) {
        return { success: true, results: stmt.all(...this.params), meta: {} };
      }
      const result = stmt.run(...this.params);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async first(column) {
      const row = db.prepare(this.sql).get(...this.params);
      return row ? (column === undefined ? row : row[column] ?? null) : null;
    }
    async raw() {
      const stmt = db.prepare(this.sql);
      stmt.setReturnArrays(true);
      return stmt.all(...this.params);
    }
  }
  return {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      // No await inside a transaction: concurrent requests cannot interleave it.
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((stmt) => stmt.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exec(sql) { db.exec(sql); },
    close() { db.close(); },
  };
}
