import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestAccounts } from '../scripts/lib/test-accounts';

// test-results/ is ignored by git, and these accounts are deleted when the run ends.
export const ACCOUNTS_FILE = resolve(import.meta.dirname, '..', 'test-results', 'live-accounts.json');

export const readAccounts = () => JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) as TestAccounts;
