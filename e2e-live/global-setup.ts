import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnv } from '../scripts/lib/env';
import { createTestAccounts } from '../scripts/lib/test-accounts';
import { ACCOUNTS_FILE } from './accounts';

export default async function globalSetup() {
  loadEnv();
  const accounts = await createTestAccounts();
  mkdirSync(dirname(ACCOUNTS_FILE), { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts));
}
