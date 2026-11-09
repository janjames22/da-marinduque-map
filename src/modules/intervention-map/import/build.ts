// Turns a file's rows into records, with the same checks the forms make, and says for each row what the
// database will flag, what might already be on the map, and what has to be fixed before importing.
import type { ImportRowInput, ImportValues } from '../data/store';
import type { InterventionType, MapData } from '../data/types';
import { parseCoordinates, type LatLng } from '../lib/coordinates';
import { isValidDate, manilaToday } from '../lib/dates';
import { BarangayIndex, closestBarangays, looseKey } from '../lib/matching';
import { computeFlags, possibleDuplicates, samePoint, type PlaceIndex } from '../lib/qa';
import { validateIntervention, validateStatus } from '../lib/validation';
import { columnFor, targetsFor, type ColumnMapping, type Target } from './fields';
import type { ParsedFile } from './parse';

type Data = Pick<MapData, 'categories' | 'programs' | 'beneficiaryTypes' | 'locationBases' | 'municipalities' | 'statuses' | 'typeStatuses' | 'barangays' | 'interventions'>;

// For each list column, what a person chose for a value the list didn't know: an item's id, a dropdown
// option's value, or null to leave it blank. Keyed by the value with case, spaces and punctuation gone.
export type ValueChoices = Record<string, Record<string, string | null>>;

export interface ImportSettings {
  type: InterventionType;
  dataSource: string;
  mapping: ColumnMapping;
  choices: ValueChoices;
  // For rows with no status of their own.
  defaultStatusId: number | null;
  // For rows with no status date of their own: the status is as of this date, the file's own.
  statusDate: string;
}

export interface ListOption {
  value: string;
  label: string;
}

// What a list column can match, for this type: active items only, as the forms offer.
export function listOptions(target: Target, type: InterventionType, data: Data): ListOption[] {
  const named = (items: { id: number; name: string; is_active?: boolean }[]) =>
    items.filter((item) => item.is_active !== false).map((item) => ({ value: String(item.id), label: item.name }));
  switch (target.list) {
    case 'categories':
      return named(data.categories.filter((category) => category.intervention_type_id === null || category.intervention_type_id === type.id));
    case 'programs':
      return named(data.programs);
    case 'beneficiaryTypes':
      return named(data.beneficiaryTypes);
    case 'locationBases':
      return named(data.locationBases);
    case 'municipalities':
      return data.municipalities.map((municipality) => ({ value: String(municipality.id), label: municipality.name }));
    case 'statuses': {
      const onList = new Set(data.typeStatuses.filter((entry) => entry.intervention_type_id === type.id).map((entry) => entry.status_id));
      return named(data.statuses.filter((status) => onList.has(status.id)));
    }
    case 'options': {
      const field = type.field_schema.fields.find((candidate) => candidate.key === target.field?.key);
      return (field?.options ?? []).filter((option) => !option.archived).map((option) => ({ value: option.value, label: option.label }));
    }
    default:
      return [];
  }
}

// Spellings a list knows by another name.
const ALIASES: Record<string, Record<string, string>> = {
  municipality: { stacruz: 'santacruz' },
};

function autoMatch(target: Target, raw: string, options: ListOption[]): string | undefined {
  const key = looseKey(raw);
  const wanted = ALIASES[target.id]?.[key] ?? key;
  return options.find((option) => looseKey(option.label) === wanted || (target.list === 'options' && looseKey(option.value) === wanted))?.value;
}

export interface UnmatchedValue {
  target: string;
  label: string;
  raw: string;
  key: string;
  rows: number;
  required: boolean;
}

// Values in list columns that match nothing, and haven't been chosen for yet.
export function unmatchedValues(file: ParsedFile, settings: ImportSettings, data: Data): UnmatchedValue[] {
  const found = new Map<string, UnmatchedValue>();
  for (const target of targetsFor(settings.type).filter((candidate) => candidate.list)) {
    const column = columnFor(settings.mapping, target.id);
    if (!column) continue;
    const options = listOptions(target, settings.type, data);
    for (const row of file.rows) {
      const raw = (row[column] ?? '').trim();
      if (raw === '' || autoMatch(target, raw, options) !== undefined) continue;
      const key = looseKey(raw);
      if (key in (settings.choices[target.id] ?? {})) continue;
      const id = `${target.id}|${key}`;
      const existing = found.get(id);
      if (existing) existing.rows += 1;
      else found.set(id, { target: target.id, label: target.label, raw, key, rows: 1, required: target.required });
    }
  }
  return [...found.values()];
}

const numberFrom = (text: string): number | null => {
  const cleaned = text.replace(/php|₱|,|\s/gi, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (value: number) => String(value).padStart(2, '0');

// A date as a sheet might hold it: 2024-03-05, 2024/03/05, 3/5/2024 (month first, as Excel writes it
// here), 5 March 2024, March 5, 2024, or a spreadsheet's day number. Anything else is refused.
export function dateFrom(text: string): string | null | 'invalid' {
  const value = text.trim();
  if (value === '') return null;
  let year: number;
  let month: number;
  let day: number;
  let match: RegExpMatchArray | null;
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(value))) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value))) {
    [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(value)) && MONTHS.includes(match[2].slice(0, 3).toLowerCase())) {
    [day, month, year] = [Number(match[1]), MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, Number(match[3])];
  } else if ((match = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value)) && MONTHS.includes(match[1].slice(0, 3).toLowerCase())) {
    [month, day, year] = [MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, Number(match[2]), Number(match[3])];
  } else if (/^\d{5}$/.test(value) && Number(value) > 30000 && Number(value) < 70000) {
    // Days since 30 December 1899, as spreadsheets count them.
    return new Date(Date.UTC(1899, 11, 30) + Number(value) * 86_400_000).toISOString().slice(0, 10);
  } else {
    return 'invalid';
  }
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  return isValidDate(iso) ? iso : 'invalid';
}

const YES = new Set(['yes', 'y', 'true', '1', 'oo']);
const NO = new Set(['no', 'n', 'false', '0', 'hindi']);

export interface PreviewRow {
  row: number;
  // Null while the row has something to fix.
  input: ImportRowInput | null;
  errors: string[];
  warnings: string[];
  // What the database will flag once it's in.
  flags: string[];
  beneficiary: string | null;
  municipality: string;
  barangay: string;
  barangayMatched: boolean;
  // The nearest names on the list, for a barangay the list doesn't have.
  candidates: string[];
  // Its ID is already on the map from the same source, so it is most likely a second copy.
  alreadyImported: boolean;
}

export function buildPreview(file: ParsedFile, settings: ImportSettings, data: Data, places: PlaceIndex, today = manilaToday()): PreviewRow[] {
  const { type } = settings;
  const targets = targetsFor(type);
  const byId = new Map(targets.map((target) => [target.id, target]));
  const options = new Map(targets.filter((target) => target.list).map((target) => [target.id, listOptions(target, type, data)]));
  const municipalityName = new Map(data.municipalities.map((municipality) => [municipality.id, municipality.name]));
  const placeNames = data.barangays.map((barangay) => ({ id: barangay.id, name: barangay.name, municipality: municipalityName.get(barangay.municipality_id) ?? '' }));
  const barangays = new BarangayIndex(placeNames);

  const rows = file.rows.map((source, index): PreviewRow => {
    const rowNumber = file.rowNumbers[index] ?? index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const cell = (target: string) => {
      const column = columnFor(settings.mapping, target);
      return column ? (source[column] ?? '').trim() : '';
    };
    const pick = (targetId: string): string | null => {
      const target = byId.get(targetId);
      const raw = cell(targetId);
      if (!target || raw === '') return null;
      const automatic = autoMatch(target, raw, options.get(targetId) ?? []);
      if (automatic !== undefined) return automatic;
      const chosen = settings.choices[targetId] ?? {};
      if (looseKey(raw) in chosen) return chosen[looseKey(raw)];
      errors.push(`${target.label} "${raw}" isn't matched to the list yet.`);
      return null;
    };
    const idOf = (targetId: string) => {
      const value = pick(targetId);
      return value === null ? null : Number(value);
    };
    const whole = (targetId: string, label: string, low: number) => {
      const raw = cell(targetId);
      const value = numberFrom(raw);
      if (value === null) return null;
      if (Number.isNaN(value) || !Number.isInteger(value) || value < low) {
        errors.push(`${label} "${raw}" isn't a whole number${low > 0 ? ` of ${low} or more` : ''}.`);
        return null;
      }
      return value;
    };

    // A name chosen as blank is no municipality either.
    const before = errors.length;
    const municipalityId = idOf('municipality');
    const municipality = municipalityId === null ? '' : (municipalityName.get(municipalityId) ?? '');
    if (municipalityId === null && errors.length === before) errors.push('No municipality. Every record needs one.');

    const barangayRaw = cell('barangay');
    const barangay = barangayRaw && municipality ? barangays.find(municipality, barangayRaw) : undefined;
    const candidates = barangayRaw && municipality && !barangay ? closestBarangays(barangayRaw, municipality, placeNames).sameMunicipality.map((candidate) => candidate.name) : [];

    let point: LatLng | null = null;
    const latitude = cell('latitude');
    const longitude = cell('longitude');
    const together = cell('coordinates');
    const written = latitude || longitude ? `${latitude}, ${longitude}` : together;
    if (written.replace(/[,\s]/g, '') !== '') {
      const parsed = parseCoordinates(written);
      if (!parsed.ok) warnings.push(`The coordinates "${written}" couldn't be read, so it comes in without them.`);
      // The RAED source, and others, write 0, 0 for "no coordinates".
      else if (parsed.point.lat !== 0 || parsed.point.lng !== 0) point = parsed.point;
    }

    const year = whole('year_funded', 'Year funded', 1900);
    const quantity = whole('quantity', 'Quantity', 1) ?? 1;
    const costText = cell('unit_cost');
    const cost = numberFrom(costText);
    if (Number.isNaN(cost) || (cost !== null && cost < 0)) errors.push(`Unit cost "${costText}" isn't an amount.`);

    const attributes: Record<string, unknown> = {};
    for (const target of targets.filter((candidate) => candidate.field)) {
      const raw = cell(target.id);
      if (raw === '') continue;
      const { key, input } = target.field!;
      if (input === 'number') {
        const value = numberFrom(raw);
        if (value === null || Number.isNaN(value)) errors.push(`${target.label} "${raw}" isn't a number.`);
        else attributes[key] = value;
      } else if (input === 'date') {
        const value = dateFrom(raw);
        if (value === 'invalid') errors.push(`${target.label} "${raw}" isn't a date. Use YYYY-MM-DD.`);
        else if (value) attributes[key] = value;
      } else if (input === 'yes_no') {
        const answer = raw.toLowerCase();
        if (YES.has(answer)) attributes[key] = true;
        else if (NO.has(answer)) attributes[key] = false;
        else errors.push(`${target.label} "${raw}" isn't yes or no.`);
      } else if (input === 'dropdown') {
        const value = pick(target.id);
        if (value !== null) attributes[key] = value;
      } else {
        attributes[key] = raw;
      }
    }

    // A blank status, in the file or chosen as blank, is the type's usual one.
    const statusRaw = cell('status');
    const statusId = (statusRaw ? idOf('status') : null) ?? settings.defaultStatusId;
    const statusDateRaw = cell('status_date');
    const ownDate = statusDateRaw ? dateFrom(statusDateRaw) : null;
    if (ownDate === 'invalid') errors.push(`Status date "${statusDateRaw}" isn't a date. Use YYYY-MM-DD.`);
    const statusDate = ownDate && ownDate !== 'invalid' ? ownDate : settings.statusDate;

    const values: ImportValues = {
      category_id: idOf('category'),
      title: cell('title') || null,
      banner_program_id: idOf('banner_program'),
      year_funded: year,
      quantity,
      unit_cost: cost === null || Number.isNaN(cost) ? null : cost,
      fund_source: cell('fund_source') || null,
      beneficiary: cell('beneficiary') || null,
      beneficiary_type_id: idOf('beneficiary_type'),
      municipality_id: municipalityId ?? 0,
      barangay_id: barangay?.id ?? null,
      barangay_raw: barangayRaw || null,
      location_basis_id: idOf('location_basis'),
      point,
      attributes,
      remarks: cell('remarks') || null,
    };

    // The same rules as a record saved on the map, and the same messages.
    if (municipalityId !== null) {
      const now = new Date(`${today}T12:00:00+08:00`);
      const fieldErrors = validateIntervention({ ...values, intervention_type_id: type.id }, null, { type, categories: data.categories, barangays: data.barangays, now });
      for (const message of Object.values(fieldErrors)) if (!errors.includes(message)) errors.push(message);
      for (const message of Object.values(validateStatus({ status_id: statusId, status_date: statusDate }, type.id, data.typeStatuses, now))) {
        errors.push(`Status: ${message}`);
      }
    }

    const flags = municipalityId === null ? [] : computeFlags({ id: null, point, municipality_id: municipalityId, barangay_id: values.barangay_id, barangay_raw: values.barangay_raw, qa_flags: [], deleted_at: null }, data.interventions, places);

    if (possibleDuplicates({ id: null, category_id: values.category_id, beneficiary: values.beneficiary, year_funded: values.year_funded, barangay_id: values.barangay_id }, data.interventions).length > 0) {
      warnings.push('Looks like a record already on the map: same category, beneficiary, year and barangay.');
    }
    const sourceId = cell('source_id') || null;
    const alreadyImported = sourceId !== null && data.interventions.some((record) => record.deleted_at === null && record.source_id === sourceId && looseKey(record.data_source ?? '') === looseKey(settings.dataSource));
    if (alreadyImported) {
      warnings.push(`Already imported from ${settings.dataSource.trim()} with this ID.`);
    }

    return {
      row: rowNumber,
      input:
        errors.length > 0
          ? null
          : {
              row: rowNumber,
              source_id: sourceId,
              source_raw: source,
              values,
              status: { status_id: statusId!, status_date: statusDate, date_basis: ownDate ? 'changed' : 'as_of', remarks: null },
            },
      errors,
      warnings,
      flags,
      beneficiary: values.beneficiary,
      municipality,
      barangay: barangay?.name ?? barangayRaw,
      barangayMatched: barangay !== undefined,
      candidates,
      alreadyImported,
    };
  });

  // Rows of the same file can share a point, or look like each other.
  const key = (row: PreviewRow) => {
    const values = row.input?.values;
    return values && values.category_id !== null && values.beneficiary && values.year_funded !== null && values.barangay_id !== null
      ? `${values.category_id}|${looseKey(values.beneficiary)}|${values.year_funded}|${values.barangay_id}`
      : null;
  };
  const counts = new Map<string, number>();
  for (const row of rows) {
    const found = key(row);
    if (found) counts.set(found, (counts.get(found) ?? 0) + 1);
  }
  rows.forEach((row, index) => {
    const found = key(row);
    if (found && (counts.get(found) ?? 0) > 1) row.warnings.push('Another row in this file has the same category, beneficiary, year and barangay.');
    const point = row.input?.values.point ?? null;
    if (point && !row.flags.includes('duplicate_point') && rows.some((other, position) => position !== index && samePoint(other.input?.values.point ?? null, point))) {
      row.flags.push('duplicate_point');
    }
  });
  return rows;
}

export interface PreviewSummary {
  rows: number;
  ready: number;
  toFix: number;
  withWarnings: number;
  flags: Record<string, number>;
}

export function summarize(rows: PreviewRow[]): PreviewSummary {
  const flags: Record<string, number> = {};
  // Of the rows that can come in as they are.
  for (const row of rows) if (row.input) for (const flag of row.flags) flags[flag] = (flags[flag] ?? 0) + 1;
  return {
    rows: rows.length,
    ready: rows.filter((row) => row.input !== null).length,
    toFix: rows.filter((row) => row.input === null).length,
    withWarnings: rows.filter((row) => row.warnings.length > 0).length,
    flags,
  };
}
