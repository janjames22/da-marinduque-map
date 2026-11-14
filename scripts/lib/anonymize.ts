// Made-up names in place of the real ones, for anything shown in public: the user guide's screenshots
// (scripts/guide-screenshots.ts) and the demo site's data (scripts/build-demo-seed.ts). The repository
// and the demo site are public, and the local dataset holds the real beneficiary names.

const MIN_NAME_LENGTH = 6; // as in scripts/check-bundle.ts: shorter ones can match ordinary words

type Json = Record<string, unknown>;

export interface Anonymized {
  text: string;
  // The real names of MIN_NAME_LENGTH letters or more, to check the result against.
  names: string[];
}

// Every beneficiary and signatory name is swapped for a made-up one and remarks are blanked. Place
// names stay. withoutHistory also leaves out the audit log, which quotes names inside longer text,
// such as a correction's evidence, where a whole-value swap can't reach them.
export function anonymize(seedText: string, { withoutHistory = false } = {}): Anonymized {
  const seed = JSON.parse(seedText) as { interventions: Json[]; status_history?: Json[]; municipalities: Json[]; barangays: Json[]; audit_log?: Json[] };
  // A beneficiary such as an LGU can share a place's name, which must stay as it is.
  const places = new Set([...seed.municipalities, ...seed.barangays].map((place) => String(place.name)));
  const names = new Set<string>();
  for (const record of seed.interventions) {
    const raw = (record.source_raw ?? {}) as Json;
    for (const value of [record.beneficiary, record.beneficiary_raw, raw.beneficiary, raw.beneficiary_raw]) {
      if (typeof value === 'string' && value.trim().length >= 3 && !places.has(value.trim())) names.add(value.trim());
    }
    record.remarks = null;
  }
  for (const entry of seed.status_history ?? []) entry.remarks = null;
  // The people who sign the reports, as on the Reports page.
  const lookups = (seed as { lookups?: { report_signatories?: Json[] } }).lookups;
  for (const signatory of lookups?.report_signatories ?? []) signatory.name = 'Full name, as signed';
  if (withoutHistory) seed.audit_log = [];

  // Whole values only, wherever they are: the records, what was imported, the history and the log.
  // A name inside a longer text is caught by findRealNames, run on the result.
  const ordered = [...names];
  const fake = new Map(
    ordered.map((name, index) => {
      const kind = /cooperative/i.test(name) ? 'Farmers Cooperative' : /irrigator/i.test(name) ? 'Irrigators Association' : 'Farmers Association';
      return [name, `Sample ${kind} ${index + 1}`];
    }),
  );
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') return fake.get(value.trim()) ?? value;
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, swap(inner)]));
    return value;
  };
  return { text: JSON.stringify(swap(seed)), names: ordered.filter((name) => name.length >= MIN_NAME_LENGTH) };
}

// The real names still in a text, if any.
export function findRealNames(text: string, names: string[]): string[] {
  return names.filter((name) => text.includes(name));
}
