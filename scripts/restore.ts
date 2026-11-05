// Puts a backup snapshot back into the project in .env.local, whose migrations must already be applied.
//
//   npm run restore -- backups/snapshot-2026-11-05.json --yes
//   npm run restore -- backups/snapshot-2026-11-05.json --yes --replace       replaces existing records
//   npm run restore -- backups/snapshot-2026-11-05.json --yes --photos backups/photos-2026-11-05
//
// See docs/OPERATIONS.md before using --replace: it removes every record made since the backup.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOKUP_TABLES, RECORD_TABLES, type Snapshot } from './backup';
import { adminClient, connectDb, loadEnv, run } from './lib/env';
import type { Queryable } from './seed-interventions';

const PHOTO_BUCKET = 'intervention-photos';
const WRITTEN_TABLES = [...LOOKUP_TABLES, ...RECORD_TABLES, 'barangays'];
// Children first, so each delete leaves nothing pointing at what it removes.
const CLEARED_TABLES = ['status_history', 'intervention_photos', 'intervention_barangays', 'saved_views', 'interventions', 'import_batches'];
// Columns naming a person. An account that no longer exists can't be pointed to.
const PERSON_COLUMNS = ['created_by', 'updated_by', 'imported_by'];

export interface RestoreResult {
  restored: Record<string, number>;
  peopleCleared: number;
  viewsDropped: number;
}

const quoted = (name: string) => `"${name}"`;

async function tableShape(db: Queryable, table: string) {
  const { rows: columns } = await db.query<{ name: string; identity: string }>(
    `select attname as name, attidentity as identity from pg_attribute
     where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`,
    [`public.${table}`],
  );
  const { rows: key } = await db.query<{ name: string }>(
    `select a.attname as name from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = $1::regclass and i.indisprimary`,
    [`public.${table}`],
  );
  return { columns, key: key.map((k) => k.name) };
}

async function loadRows(db: Queryable, table: string, rows: Record<string, unknown>[], onConflict: 'update' | 'nothing' | 'fail') {
  if (rows.length === 0) return;
  const { columns, key } = await tableShape(db, table);
  const names = columns.map((column) => quoted(column.name)).join(', ');
  const hasIdentity = columns.some((column) => column.identity !== '');
  const others = columns.filter((column) => !key.includes(column.name));
  const target = key.map(quoted).join(', ');
  const conflict =
    onConflict === 'fail'
      ? ''
      : onConflict === 'update' && others.length > 0
        ? `on conflict (${target}) do update set ${others.map((c) => `${quoted(c.name)} = excluded.${quoted(c.name)}`).join(', ')}`
        : `on conflict (${target}) do nothing`;

  await db.query(
    `insert into public.${table} (${names}) ${hasIdentity ? 'overriding system value' : ''}
     select ${names} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) ${conflict}`,
    [JSON.stringify(rows)],
  );
}

export async function restoreSnapshot(db: Queryable, snapshot: Snapshot, { replace = false, file = 'snapshot' } = {}): Promise<RestoreResult> {
  await db.query('begin');
  try {
    const { rows: counts } = await db.query<{ n: number }>('select count(*)::int as n from public.interventions');
    if (counts[0].n > 0 && !replace) {
      throw new Error(`The database already has ${counts[0].n} records. Nothing was changed. See docs/OPERATIONS.md about --replace.`);
    }

    // Record ids point at barangays by number, so a different list would put records in the wrong places.
    const { rows: current } = await db.query<{ id: number; psgc_code: string }>('select id, psgc_code from public.barangays');
    const currentById = new Map(current.map((b) => [b.id, b.psgc_code]));
    for (const barangay of snapshot.barangays) {
      if (currentById.get(barangay.id) !== barangay.psgc_code) {
        throw new Error(`Barangay ${barangay.name} doesn't match this database (id ${barangay.id}). Nothing was changed.`);
      }
    }

    // What's in the backup already passed the rules, and running them again would raise version
    // numbers and write the whole backup into the audit log.
    for (const table of WRITTEN_TABLES) await db.query(`alter table public.${table} disable trigger user`);

    if (replace) {
      for (const table of CLEARED_TABLES) await db.query(`delete from public.${table}`);
    }

    for (const table of LOOKUP_TABLES) await loadRows(db, table, snapshot.tables[table], 'update');

    const { rows: accounts } = await db.query<{ id: string }>('select id from auth.users');
    const known = new Set(accounts.map((account) => account.id));
    let peopleCleared = 0;
    const withKnownPeople = (row: Record<string, unknown>) => {
      const copy = { ...row };
      for (const column of PERSON_COLUMNS) {
        if (typeof copy[column] === 'string' && !known.has(copy[column])) {
          copy[column] = null;
          peopleCleared += 1;
        }
      }
      return copy;
    };

    await loadRows(db, 'profiles', snapshot.tables.profiles.filter((p) => known.has(p.id as string)), 'update');
    const restored: Record<string, number> = {};
    const keptViews = snapshot.tables.saved_views.filter((view) => known.has(view.owner_id as string));

    for (const table of RECORD_TABLES) {
      if (table === 'profiles') continue;
      const rows = table === 'saved_views' ? keptViews : table === 'audit_log' ? snapshot.tables.audit_log : snapshot.tables[table].map(withKnownPeople);
      // The log may hold entries made since the backup, and those are worth keeping.
      await loadRows(db, table, rows, table === 'audit_log' ? 'nothing' : 'fail');
      restored[table] = rows.length;
    }

    await db.query(
      `update public.barangays b set attributes = x.attributes, version = x.version
       from jsonb_to_recordset($1::jsonb) as x (id integer, attributes jsonb, version integer)
       where b.id = x.id`,
      [JSON.stringify(snapshot.barangays)],
    );

    // Rows were loaded with their old ids, so the next new row must start after them.
    for (const table of [...LOOKUP_TABLES, 'audit_log']) {
      const { columns } = await tableShape(db, table);
      if (!columns.some((column) => column.name === 'id' && column.identity !== '')) continue;
      await db.query(
        `select setval(pg_get_serial_sequence($1, 'id'), greatest((select max(id) from public.${table}), 1)::bigint)`,
        [`public.${table}`],
      );
    }

    for (const table of WRITTEN_TABLES) await db.query(`alter table public.${table} enable trigger user`);

    await db.query(
      `insert into public.audit_log (table_name, action, context) values ('backup', 'restore', $1::jsonb)`,
      [JSON.stringify({ file, backup_taken: snapshot.created_at, replaced: replace, records: restored.interventions })],
    );

    await db.query('commit');
    return { restored, peopleCleared, viewsDropped: snapshot.tables.saved_views.length - keptViews.length };
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

async function uploadPhotos(directory: string) {
  const storage = adminClient().storage.from(PHOTO_BUCKET);
  const files = filesUnder(directory);
  let failed = 0;
  for (const file of files) {
    const path = relative(directory, file).split(sep).join('/');
    const extension = path.split('.').pop();
    const contentType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    const { error } = await storage.upload(path, readFileSync(file), { contentType, upsert: true });
    if (error) {
      failed += 1;
      console.error(`Could not upload ${path}: ${error.message}`);
    }
  }
  console.log(`Photos: ${files.length - failed} of ${files.length} uploaded.`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(async () => {
    const args = process.argv.slice(2);
    const file = args.find((arg) => arg.endsWith('.json'));
    if (!file) throw new Error('Give the snapshot file, such as backups/snapshot-2026-11-05.json.');
    if (!args.includes('--yes')) throw new Error('This changes the live database. Read docs/OPERATIONS.md, then run it again with --yes.');

    loadEnv();
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
    const db = await connectDb();
    try {
      const result = await restoreSnapshot(db, snapshot, { replace: args.includes('--replace'), file });
      console.log('Restored:', result.restored);
      if (result.peopleCleared > 0) {
        console.log(`${result.peopleCleared} "created by" or "updated by" values were cleared, as those accounts no longer exist. The audit log keeps their ids.`);
      }
      if (result.viewsDropped > 0) console.log(`${result.viewsDropped} saved views were left out, as their owners no longer exist.`);
      console.log('Ask everyone to reload the map.');
    } finally {
      await db.end();
    }

    const photos = args.indexOf('--photos');
    if (photos !== -1) await uploadPhotos(args[photos + 1]);
  });
}
