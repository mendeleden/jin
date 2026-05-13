import type { Database, SQLQueryBindings } from "bun:sqlite";

export function allRows<Row>(
  db: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): Row[] {
  const statement = db.prepare<Row, SQLQueryBindings[]>(sql);
  try {
    return statement.all(...bindings);
  } finally {
    statement.finalize();
  }
}

export function getRow<Row>(
  db: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): Row | null {
  const statement = db.prepare<Row, SQLQueryBindings[]>(sql);
  try {
    return statement.get(...bindings) ?? null;
  } finally {
    statement.finalize();
  }
}

export function runInTransaction<Result>(
  db: Database,
  action: () => Result,
): Result {
  if (db.inTransaction) {
    return action();
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}
