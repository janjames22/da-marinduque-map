import { rmSync } from 'node:fs';
import { loadEnv } from '../scripts/lib/env';
import { removeTestAccounts } from '../scripts/lib/test-accounts';
import { ACCOUNTS_FILE } from './accounts';

export default async function globalTeardown() {
  loadEnv();
  await removeTestAccounts();
  rmSync(ACCOUNTS_FILE, { force: true });
}
