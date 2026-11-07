import type { LatLng } from '../lib/coordinates';
import type { AppUser, AuditEntry, Barangay, CoreFieldRule, FieldSchema, Intervention, InterventionType, MapData, StatusEntry, UserRole } from './types';

// Everything a person enters for a record. Location is a point for now, as both active types are.
export interface InterventionValues {
  intervention_type_id: number;
  category_id: number | null;
  title: string | null;
  banner_program_id: number | null;
  year_funded: number | null;
  quantity: number;
  unit_cost: number | null;
  fund_source: string | null;
  beneficiary: string | null;
  beneficiary_type_id: number | null;
  municipality_id: number;
  barangay_id: number | null;
  location_basis_id: number | null;
  point: LatLng | null;
  attributes: Record<string, unknown>;
  remarks: string | null;
  // New files for photo fields, by field key. Their attributes hold PENDING_PHOTO until they're saved.
  field_photos?: Record<string, File>;
}

// A record's type can't change, because its custom fields and status list belong to the type.
export type InterventionPatch = Partial<Omit<InterventionValues, 'intervention_type_id'>> & {
  clear_name_check?: boolean;
};

export interface NewStatus {
  status_id: number;
  status_date: string;
  remarks: string | null;
  photo?: File | null;
}

export interface PhotoMeta {
  taken_at: string | null;
  exif_location: LatLng | null;
}

// Goes to the audit log with the change: why it was made, and what kind of change it was.
export interface ChangeNote {
  kind: 'create' | 'edit' | 'move' | 'resolve' | 'status' | 'baseline' | 'delete' | 'restore' | 'admin';
  reason?: string;
}

export class ConflictError extends Error {
  readonly latest: Intervention | Barangay | null;

  constructor(latest: Intervention | Barangay | null) {
    super('This record was changed by someone else');
    this.name = 'ConflictError';
    this.latest = latest;
  }
}

export class ValidationError extends Error {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Check the highlighted fields');
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export class LocalSeedMissingError extends Error {
  constructor() {
    super('Local dataset not found');
    this.name = 'LocalSeedMissingError';
  }
}

// What the audit log keeps about an export.
export interface ExportLogEntry {
  format: string;
  file_name: string;
  filters: Record<string, unknown>;
  record_count: number;
}

export type LookupTable = 'programs' | 'categories' | 'category_groups' | 'statuses' | 'beneficiary_types' | 'location_bases' | 'icons';

// One row of a list. Which of these apply depends on the list, and an update sends only what changes.
export interface LookupValues {
  code?: string;
  name?: string;
  color?: string;
  image?: string;
  icon_id?: number | null;
  intervention_type_id?: number | null;
  category_group_id?: number | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface TypeValues {
  code: string;
  name: string;
  geometry_kind: InterventionType['geometry_kind'];
  icon_id: number | null;
  color: string;
  core_field_rules: Record<string, CoreFieldRule>;
  field_schema: FieldSchema;
  sort_order: number;
  is_active: boolean;
}

export interface TypeStatusValues {
  status_id: number;
  is_default: boolean;
  counts_as_operational: boolean;
}

export type PersonStatus = 'active' | 'invited' | 'deactivated' | 'no_access';
export type InviteDelivery = 'email' | 'link';

export interface Person {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole | null;
  status: PersonStatus;
  invited_at: string | null;
  last_sign_in_at: string | null;
}

// Who can use the map. Local mode has no accounts, so it has no people.
export interface PeopleApi {
  list(): Promise<Person[]>;
  invite(input: { email: string; full_name: string; role: UserRole; delivery: InviteDelivery }): Promise<{ link: string | null }>;
  newLink(id: string, delivery: InviteDelivery): Promise<{ link: string | null }>;
  update(id: string, changes: { role?: UserRole; full_name?: string }): Promise<void>;
  deactivate(id: string): Promise<void>;
  reactivate(id: string): Promise<void>;
}

export type ConnectionListener = (live: boolean) => void;

// Only for local mode, whose changes live in one browser.
export interface LocalControls {
  changeCount(): Promise<number>;
  newerSeedAvailable(): boolean;
  reset(): Promise<void>;
}

// All data goes through this, so screens don't change when the app moves from local data to
// Supabase. Writes reject with ConflictError if the record changed since expectedVersion was read,
// and with ValidationError if the values break a rule.
export interface DataStore {
  user: AppUser;
  load(): Promise<MapData>;
  createIntervention(values: InterventionValues, status: NewStatus, note?: ChangeNote): Promise<Intervention>;
  updateIntervention(id: string, expectedVersion: number, patch: InterventionPatch, note?: ChangeNote): Promise<Intervention>;
  softDeleteIntervention(id: string, expectedVersion: number, note?: ChangeNote): Promise<Intervention>;
  restoreIntervention(id: string, expectedVersion: number, note?: ChangeNote): Promise<Intervention>;
  addStatus(interventionId: string, status: NewStatus, note?: ChangeNote): Promise<StatusEntry>;
  updateBarangayBaseline(id: number, expectedVersion: number, attributes: Record<string, unknown>, note?: ChangeNote): Promise<Barangay>;
  auditFor(interventionId: string): Promise<AuditEntry[]>;
  logExport(entry: ExportLogEntry): Promise<void>;
  // An Admin's changes to the lists and forms. They reject with ConflictError if someone else saved
  // the type or the barangay form first, and with ValidationError if the values break a rule.
  saveLookup(table: LookupTable, id: number | null, values: LookupValues): Promise<void>;
  saveType(id: number | null, expectedVersion: number | null, values: TypeValues, statuses: TypeStatusValues[]): Promise<InterventionType>;
  saveBarangayFields(expectedVersion: number, schema: FieldSchema): Promise<void>;
  people?: PeopleApi;
  photoUrl(photoId: string): Promise<string | null>;
  // Fires on any change, from this tab or another. Screens reload through load().
  subscribe(listener: () => void): () => void;
  // Starts live updates from other devices, and reports when they stop and resume. Local mode has none.
  watchConnection?(listener: ConnectionListener): () => void;
  local?: LocalControls;
}
