import { describe, expect, it } from 'vitest';
import { buildDemoSeed } from '../scripts/build-demo-seed';
import { DEMO_ACCOUNTS, demoUser, findDemoAccount } from '../src/app/auth/demo-accounts';

const seed = {
  municipalities: [{ id: 1, name: 'Gasan' }],
  barangays: [{ id: 10, name: 'Tabionan', municipality_id: 1 }],
  lookups: { report_signatories: [{ id: 1, label: 'Noted by', name: 'Engr. Juan Dela Cruz' }] },
  interventions: [
    { id: 'a', beneficiary: 'Tabionan Farmers Association', remarks: 'Call Maria Santos', source_raw: { beneficiary: 'TABIONAN FARMERS ASSN.', municipality: 'Gasan' } },
  ],
  status_history: [{ intervention_id: 'a', remarks: 'Checked by Pedro Reyes' }],
  audit_log: [{ context: { evidence: 'Confirmed with Tabionan Farmers Association by phone' } }],
};

describe("the demo site's data", () => {
  const out = JSON.parse(buildDemoSeed(JSON.stringify(seed))) as typeof seed;

  it('has made-up names only, the history left out as it quotes names inside its notes', () => {
    const text = JSON.stringify(out);
    for (const real of ['Tabionan Farmers Association', 'TABIONAN FARMERS ASSN.', 'Maria Santos', 'Pedro Reyes', 'Juan Dela Cruz']) expect(text).not.toContain(real);
    expect(out.interventions[0].beneficiary).toMatch(/^Sample Farmers Association \d+$/);
    expect(out.audit_log).toEqual([]);
  });

  it('keeps the places', () => {
    expect(out.municipalities[0].name).toBe('Gasan');
    expect(out.barangays[0].name).toBe('Tabionan');
  });
});

describe("the demo site's accounts", () => {
  it('has one per role', () => {
    expect(DEMO_ACCOUNTS.map((account) => account.role).sort()).toEqual(['admin', 'encoder', 'viewer']);
  });

  it('signs in with an email in any case and its exact password, and nothing else', () => {
    const admin = DEMO_ACCOUNTS.find((account) => account.role === 'admin')!;
    expect(findDemoAccount(' ADMIN@demo.test ', admin.password)).toBe(admin);
    expect(findDemoAccount(admin.email, admin.password.toLowerCase())).toBeNull();
    expect(findDemoAccount('someone@else.test', admin.password)).toBeNull();
    expect(demoUser(admin)).toEqual({ id: 'demo-admin', full_name: 'Demo admin', role: 'admin' });
  });
});
