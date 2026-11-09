// The QA queue: every flagged record, by what was found and where. A flag a person dismissed is left
// out unless asked for, and so are deleted records, which nobody can work on.
import type { Intervention, MapData, QaDismissal } from '../data/types';
import { FLAG_LABELS, recordName } from './display';
import { foldText } from './view-fields';

// Worst first: a record that can't be put on the map at all, then one that may be in the wrong place,
// then what only needs a second look.
export const FLAG_ORDER = [
  'out_of_province',
  'no_coords',
  'barangay_unmatched',
  'no_barangay',
  'muni_mismatch',
  'barangay_mismatch',
  'beneficiary_name_check',
  'duplicate_point',
];

// What each flag asks a person to do.
export const FLAG_ADVICE: Record<string, string> = {
  out_of_province: 'The coordinates are outside Marinduque, usually a typing slip. Fix the location.',
  no_coords: 'No usable coordinates. Add them from a visit or a geotagged photo.',
  barangay_unmatched: 'The file named a barangay that isn\'t on the official list. Set the right one.',
  no_barangay: 'No barangay was given. Set it.',
  muni_mismatch: 'The point is outside the encoded municipality. Fix the location or the municipality.',
  barangay_mismatch: 'The point is outside the encoded barangay. Fix whichever is wrong, or set the location basis if the point marks somewhere else on purpose, such as the FCA\'s office.',
  beneficiary_name_check: 'The beneficiary\'s name needs checking. Correct it, or dismiss the flag once it\'s confirmed.',
  duplicate_point: 'Another record has the same coordinates. Often right, such as two units at one FCA.',
};

export interface QueueItem {
  record: Intervention;
  flag: string;
  dismissal: QaDismissal | null;
}

export interface QueueGroup {
  flag: string;
  label: string;
  total: number;
  municipalities: { id: number; name: string; items: QueueItem[] }[];
}

export interface QueueFilters {
  municipalityId: number | null;
  flag: string | null;
  showDismissed: boolean;
  search: string;
}

type QueueData = Pick<MapData, 'interventions' | 'qaDismissals' | 'municipalities' | 'categories' | 'types'>;

export function buildQueue(data: QueueData, filters: QueueFilters): QueueGroup[] {
  const dismissals = new Map(data.qaDismissals.map((dismissal) => [`${dismissal.intervention_id}|${dismissal.flag}`, dismissal]));
  const wanted = foldText(filters.search);
  const municipalityName = new Map(data.municipalities.map((municipality) => [municipality.id, municipality.name]));

  const groups = new Map<string, Map<number, QueueItem[]>>();
  for (const record of data.interventions) {
    if (record.deleted_at !== null) continue;
    if (filters.municipalityId !== null && record.municipality_id !== filters.municipalityId) continue;
    if (wanted && !foldText([recordName(record, data), record.beneficiary, record.source_id, record.barangay_raw].filter(Boolean).join(' ')).includes(wanted)) continue;
    for (const flag of record.qa_flags) {
      if (filters.flag !== null && flag !== filters.flag) continue;
      const dismissal = dismissals.get(`${record.id}|${flag}`) ?? null;
      if (dismissal && !filters.showDismissed) continue;
      const byPlace = groups.get(flag) ?? new Map<number, QueueItem[]>();
      byPlace.set(record.municipality_id, [...(byPlace.get(record.municipality_id) ?? []), { record, flag, dismissal }]);
      groups.set(flag, byPlace);
    }
  }

  const rank = (flag: string) => (FLAG_ORDER.includes(flag) ? FLAG_ORDER.indexOf(flag) : FLAG_ORDER.length);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([flag, byPlace]) => {
      const municipalities = [...byPlace.entries()]
        .map(([id, items]) => ({
          id,
          name: municipalityName.get(id) ?? 'Unknown',
          items: items.sort((a, b) => recordName(a.record, data).localeCompare(recordName(b.record, data)) || (a.record.beneficiary ?? '').localeCompare(b.record.beneficiary ?? '')),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { flag, label: FLAG_LABELS[flag] ?? flag, total: municipalities.reduce((sum, place) => sum + place.items.length, 0), municipalities };
    });
}

// How many open flags of each kind, for the filter's choices, before any filter but the place.
export function flagCounts(data: QueueData, municipalityId: number | null): Record<string, number> {
  const dismissed = new Set(data.qaDismissals.map((dismissal) => `${dismissal.intervention_id}|${dismissal.flag}`));
  const counts: Record<string, number> = {};
  for (const record of data.interventions) {
    if (record.deleted_at !== null || (municipalityId !== null && record.municipality_id !== municipalityId)) continue;
    for (const flag of record.qa_flags) if (!dismissed.has(`${record.id}|${flag}`)) counts[flag] = (counts[flag] ?? 0) + 1;
  }
  return counts;
}

// Units waiting for a condition check: at a status that doesn't count as assessed, such as Turned-over.
export function awaitingCheck(data: Pick<MapData, 'interventions' | 'statuses'>, filters: { municipalityId: number | null; statusId: number | null }): Intervention[] {
  const waiting = new Set(data.statuses.filter((status) => status.counts_as_assessed === false).map((status) => status.id));
  return data.interventions.filter(
    (record) =>
      record.deleted_at === null &&
      record.status_id !== null &&
      waiting.has(record.status_id) &&
      (filters.statusId === null || record.status_id === filters.statusId) &&
      (filters.municipalityId === null || record.municipality_id === filters.municipalityId),
  );
}
