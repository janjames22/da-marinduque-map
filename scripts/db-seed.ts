// Loads the RAED records and confirmed corrections into the project in .env.local. This is for an
// empty database only, so it can't overwrite anything people have since encoded.
//
// Usage: npm run db:seed
import { connectDb, loadEnv, run } from './lib/env';
import { loadSeedFiles, printReport, seedInterventions } from './seed-interventions';

run(async () => {
  loadEnv();
  const db = await connectDb();
  try {
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.interventions');
    if (rows[0].n > 0) throw new Error(`The database already has ${rows[0].n} records, so nothing was loaded.`);

    db.on('notice', () => {}); // a warning per record if nobody has connected to live updates yet
    const { rows: csv, corrections } = loadSeedFiles();
    printReport(await seedInterventions(db, csv, corrections));
  } finally {
    await db.end();
  }
});
