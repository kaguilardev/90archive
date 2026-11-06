// Database connection. Production uses Render Postgres through DATABASE_URL.
// Local development and tests use PGlite, an embedded Postgres that needs no setup.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jerseys (
    slug text PRIMARY KEY,
    position integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS media (
    id text PRIMARY KEY,
    mime text NOT NULL,
    data bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS orders (
    id text PRIMARY KEY,
    number serial UNIQUE,
    status text NOT NULL,
    channel text NOT NULL,
    stripe_session text UNIQUE,
    customer jsonb NOT NULL DEFAULT '{}',
    items jsonb NOT NULL,
    subtotal_cents integer NOT NULL,
    shipping_cents integer NOT NULL DEFAULT 0,
    total_cents integer NOT NULL,
    carrier text NOT NULL DEFAULT '',
    tracking text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    stock_applied boolean NOT NULL DEFAULT false,
    needs_review boolean NOT NULL DEFAULT false,
    events jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    paid_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS orders_status_created ON orders (status, created_at DESC);
  CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL
  );
`;

function pgDatabase(url) {
  // Render's external database hostnames require TLS; its internal ones do not support it.
  const ssl = /\.render\.com/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl, max: 5 });
  return {
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn((sql, params) => client.query(sql, params));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function embeddedDatabase(dir) {
  // A development-only package, so it is imported only when actually needed.
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  return {
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    tx: (fn) => db.transaction((t) => fn((sql, params) => t.query(sql, params))),
    close: () => db.close(),
  };
}

// Returns null in production without DATABASE_URL, so the site can keep serving its catalog file.
export async function openDatabase({ url = process.env.DATABASE_URL, dir, memory = false } = {}) {
  let db;
  if (url) db = pgDatabase(url);
  else if (memory) db = await embeddedDatabase();
  else if (process.env.NODE_ENV === 'production') return null;
  else {
    // Kept outside the project folder, because OneDrive syncing can corrupt a live database.
    const folder = dir || join(tmpdir(), '90archive-dev-db');
    mkdirSync(folder, { recursive: true });
    db = await embeddedDatabase(folder);
  }
  await db.exec(SCHEMA);
  return db;
}
