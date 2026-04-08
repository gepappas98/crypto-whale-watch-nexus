/* ══ WHALE RADAR — PostgreSQL Pool ════════════════════════════════════════════ */
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.warn('[DB] DATABASE_URL not set — persistence disabled');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

/** Run a query. Returns rows or throws. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

/** Health-check — returns true if DB is reachable. */
export async function ping(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
