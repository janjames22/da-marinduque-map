// Applies supabase/migrations to the project in .env.local. Each file runs once, in its own
// transaction, and the ones already applied are recorded in private.schema_migrations.
//
// Usage: npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Queryable } from './seed-interventions';
import { connectDb, loadEnv, run } from './lib/env';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'supabase', 'migrations');

export async function applyMigrations(db: Queryable, log: (line: string) => void = console.log) {
  await db.query('create schema if not exists private');
  await db.query(`create table if not exists private.schema_migrations (
    file text primary key,
    applied_at timestamptz not null default now()
  )`);
  const { rows } = await db.query<{ file: string }>('select file from private.schema_migrations');
  const applied = new Set(rows.map((row) => row.file));

  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    log(`Applying ${file}`);
    await db.query('begin');
    try {
      await db.query('set local search_path to public, extensions');
      await db.query(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'));
      await db.query('insert into private.schema_migrations (file) values ($1)', [file]);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw new Error(`${file} failed, and was rolled back: ${(error as Error).message}`);
    }
    count += 1;
  }
  log(count === 0 ? 'Already up to date.' : `Applied ${count} of ${files.length} migrations.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(async () => {
    loadEnv();
    const db = await connectDb();
    try {
      await applyMigrations(db);
    } finally {
      await db.end();
    }
  });
}
