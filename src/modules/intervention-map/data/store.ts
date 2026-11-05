import type { LatLng } from '../lib/coordinates';
import type { AuditEntry, Barangay, Intervention, MapData, StatusEntry } from './types';

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
  kind: 'create' | 'edit' | 'move' | 'resolve' | 'status' | 'baseline' | 'delete' | 'restore';
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
  load(): Promise<MapData>;
  createIntervention(values: InterventionValues, status: NewStatus, note?: ChangeNote): Promise<Intervention>;
  updateIntervention(id: string, expectedVersion: number, patch: InterventionPatch, note?: ChangeNote): Promise<Intervention>;
  softDeleteIntervention(id: string, expectedVersion: number, note?: ChangeNote): Promise<Intervention>;
  restoreIntervention(id: string, expectedVersion: number, note?: ChangeNote): Promise<Intervention>;
  addStatus(interventionId: string, status: NewStatus, note?: ChangeNote): Promise<StatusEntry>;
  updateBarangayBaseline(id: number, expectedVersion: number, attributes: Record<string, unknown>, note?: ChangeNote): Promise<Barangay>;
  auditFor(interventionId: string): Promise<AuditEntry[]>;
  photoUrl(photoId: string): Promise<string | null>;
  // Fires on any change, from this tab or another. Screens reload through load().
  subscribe(listener: () => void): () => void;
  local?: LocalControls;
}
