// Shapes of the data the map works with, matching the database tables and interventions_v.

export type UserRole = 'admin' | 'encoder' | 'viewer';

export interface AppUser {
  id: string;
  full_name: string | null;
  role: UserRole;
}

export interface Member {
  id: string;
  full_name: string | null;
}

export interface FieldOption {
  value: string;
  label: string;
  archived?: boolean;
}

export interface FieldDefinition {
  key: string;
  label: string;
  input: 'text' | 'number' | 'date' | 'dropdown' | 'yes_no' | 'photo';
  unit?: string;
  required?: boolean;
  archived?: boolean;
  options?: FieldOption[];
}

export interface FieldSchema {
  fields: FieldDefinition[];
}

export interface Icon {
  id: number;
  name: string;
  image: string;
}

export interface Program {
  id: number;
  code: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

export interface Category {
  id: number;
  name: string;
  intervention_type_id: number | null;
  icon_id?: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface Status {
  id: number;
  name: string;
  color: string;
}

export interface LocationBasis {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface BeneficiaryType {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export type CoreFieldRule = 'required' | 'optional' | 'hidden';

export interface InterventionType {
  id: number;
  code: string;
  name: string;
  geometry_kind: 'point' | 'line' | 'polygon';
  icon_id: number | null;
  color: string;
  core_field_rules: Record<string, CoreFieldRule>;
  field_schema: FieldSchema;
  sort_order: number;
  is_active: boolean;
}

export interface TypeStatus {
  intervention_type_id: number;
  status_id: number;
  sort_order: number;
  is_default: boolean;
  counts_as_operational: boolean;
}

export interface Municipality {
  id: number;
  name: string;
  psgc_code: string;
}

export interface Barangay {
  id: number;
  municipality_id: number;
  name: string;
  psgc_code: string;
  attributes: Record<string, unknown>;
  version: number;
}

export interface Intervention {
  id: string;
  source_id?: string | null;
  source_page?: number | null;
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
  barangay_raw: string | null;
  location_basis_id: number | null;
  status_id: number | null;
  attributes: Record<string, unknown>;
  remarks: string | null;
  data_source: string | null;
  qa_flags: string[];
  geojson: GeoJSON.Geometry | null;
  plotted_barangay_id: number | null;
  plotted_barangay: string | null;
  plotted_municipality: string | null;
  version: number;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface InterventionBarangay {
  intervention_id: string;
  barangay_id: number;
  link_source: 'encoded' | 'spatial';
}

export interface StatusEntry {
  id: string;
  intervention_id: string;
  status_id: number;
  status_date: string;
  date_basis: 'changed' | 'as_of';
  source_note: string | null;
  remarks: string | null;
  photo_id: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface InterventionPhoto {
  id: string;
  intervention_id: string;
  storage_path: string;
  caption: string | null;
  taken_at: string | null;
  exif_location: GeoJSON.Point | null;
  created_at: string;
}

export type AuditAction = 'insert' | 'update' | 'delete' | 'soft_delete' | 'restore' | 'export';

export interface AuditEntry {
  id: number;
  table_name: string;
  record_id: string | null;
  action: AuditAction;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name?: string | null;
  context: Record<string, unknown> | null;
  at: string;
}

export interface MapData {
  icons: Icon[];
  programs: Program[];
  categories: Category[];
  statuses: Status[];
  locationBases: LocationBasis[];
  beneficiaryTypes: BeneficiaryType[];
  types: InterventionType[];
  typeStatuses: TypeStatus[];
  municipalities: Municipality[];
  barangays: Barangay[];
  barangayFields: FieldSchema;
  interventions: Intervention[];
  links: InterventionBarangay[];
  statusHistory: StatusEntry[];
  photos: InterventionPhoto[];
  dataSources: string[];
  members: Member[];
}
