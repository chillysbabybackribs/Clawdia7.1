import type Database from 'better-sqlite3';

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

export interface Budget {
  id: number;
  limitUsd: number; // in cents
  period: BudgetPeriod;
  resetDay: number; // 0-6 for weekly, 1-31 for monthly
  isActive: boolean;
}

export interface Transaction {
  id: number;
  runId: string;
  merchant: string; // e.g. "anthropic", "google"
  amountUsd: number; // in cents
  isEstimated: boolean;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  createdAt: string;
}

let db: Database.Database;

export function initSpending(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS spending_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL UNIQUE,
      limit_usd INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      reset_day INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS spending_transactions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id            TEXT REFERENCES runs(id) ON DELETE SET NULL,
      merchant          TEXT NOT NULL,
      amount_usd        INTEGER NOT NULL,
      description       TEXT,
      payment_method_id INTEGER,
      status            TEXT NOT NULL CHECK(status IN ('pending','completed','failed','refunded')),
      is_estimated      INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed a default daily budget if none exists
  const count = (db.prepare('SELECT COUNT(*) as count FROM spending_budgets').get() as any).count;
  if (count === 0) {
    db.prepare('INSERT INTO spending_budgets (limit_usd, period, reset_day) VALUES (?, ?, ?)')
      .run(500, 'daily', 1); // $5.00 daily limit
  }
}

export function listActiveBudgets(): Budget[] {
  return db.prepare('SELECT id, limit_usd as limitUsd, period, reset_day as resetDay, is_active as isActive FROM spending_budgets WHERE is_active = 1')
    .all() as Budget[];
}

export function insertTransaction(t: Omit<Transaction, 'id' | 'createdAt'>): number {
  const result = db.prepare(`
    INSERT INTO spending_transactions (run_id, merchant, amount_usd, is_estimated, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(t.runId, t.merchant, t.amountUsd, t.isEstimated ? 1 : 0, t.status);
  return result.lastInsertRowid as number;
}

export function updateTransactionToActual(id: number, actualCents: number): void {
  db.prepare("UPDATE spending_transactions SET amount_usd = ?, is_estimated = 0, status = 'completed' WHERE id = ?")
    .run(actualCents, id);
}

export function updateTransactionStatus(id: number, status: Transaction['status']): void {
  db.prepare('UPDATE spending_transactions SET status = ? WHERE id = ?')
    .run(status, id);
}

export function sumPeriodSpend(sinceIso: string): number {
  const result = (db.prepare(`
    SELECT SUM(amount_usd) as total 
    FROM spending_transactions 
    WHERE created_at >= ? AND status != 'failed'
  `).get(sinceIso) as any);
  return result?.total || 0;
}
