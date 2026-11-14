import { describe, expect, it } from 'vitest';
import { anonymize } from '../scripts/lib/anonymize';

const seed = {
  municipalities: [{ id: 1, name: 'Gasan' }],
  barangays: [{ id: 10, name: 'Tabionan', municipality_id: 1 }],
  lookups: { report_signatories: [{ id: 1, label: 'Prepared by', name: 'Engr. Juan Dela Cruz' }] },
  interventions: [
    { id: 'a', beneficiary: 'Tabionan Farmers Association', remarks: 'Call Maria Santos', source_raw: { beneficiary: 'TABIONAN FARMERS ASSN.', municipality: 'Gasan' } },
    { id: 'b', beneficiary: 'Mogpog Irrigators Association', remarks: null, source_raw: { beneficiary_raw: 'Mogpog Irrigators Association' } },
    { id: 'c', beneficiary: 'Gasan', remarks: null, source_raw: {} },
  ],
  status_history: [{ intervention_id: 'a', remarks: 'Checked by Pedro Reyes' }],
  audit_log: [{ new_values: { beneficiary: 'Tabionan Farmers Association' } }],
};

describe("the guide's screenshots", () => {
  const { text, names } = anonymize(JSON.stringify(seed));
  const out = JSON.parse(text) as typeof seed;

  it('swap every beneficiary name, wherever it is, for a made-up one', () => {
    for (const name of ['Tabionan Farmers Association', 'TABIONAN FARMERS ASSN.', 'Mogpog Irrigators Association']) expect(text).not.toContain(name);
    expect(out.interventions[0].beneficiary).toMatch(/^Sample Farmers Association \d+$/);
    expect(out.interventions[1].beneficiary).toMatch(/^Sample Irrigators Association \d+$/);
    expect(out.interventions[1].source_raw.beneficiary_raw).toBe(out.interventions[1].beneficiary);
    expect(out.audit_log[0].new_values.beneficiary).toBe(out.interventions[0].beneficiary);
  });

  it('blank the remarks and the signatories, which can hold anyone', () => {
    expect(text).not.toContain('Maria Santos');
    expect(text).not.toContain('Pedro Reyes');
    expect(text).not.toContain('Juan Dela Cruz');
  });

  it("leave places alone, even a beneficiary that's a place's name", () => {
    expect(out.municipalities[0].name).toBe('Gasan');
    expect(out.barangays[0].name).toBe('Tabionan');
    expect(out.interventions[0].source_raw.municipality).toBe('Gasan');
    expect(out.interventions[2].beneficiary).toBe('Gasan');
  });

  it('give the names to look for on screen, as the build check does', () => {
    expect(names).toContain('Tabionan Farmers Association');
    expect(names).not.toContain('Gasan');
  });
});
