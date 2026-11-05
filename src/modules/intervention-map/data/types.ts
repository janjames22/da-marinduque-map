// Shapes of the data the map works with, matching the database tables and interventions_v.

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
}

export interface Status {
  id: number;
  name: string;
  color: string;
}

export interface LocationBasis {
  id: number;
  name: string;
}

export interface InterventionType {
  id: number;
  code: string;
  name: string;
  geometry_kind: 'point' | 'line' | 'polygon';
  icon_id: number | null;
  color: string;
  field_schema: FieldSchema;
  sort_order: number;
  is_active: boolean;
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
}

export interface Intervention {
  id: string;
  intervention_type_id: number;
  category_id: number | null;
  title: string | null;
  banner_program_id: number | null;
  year_funded: number | null;
  quantity: number;
  beneficiary: string | null;
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
  plotted_barangay: string | null;
  plotted_municipality: string | null;
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
  created_at: string;
}

export interface MapData {
  icons: Icon[];
  programs: Program[];
  categories: Category[];
  statuses: Status[];
  locationBases: LocationBasis[];
  types: InterventionType[];
  municipalities: Municipality[];
  barangays: Barangay[];
  barangayFields: FieldSchema;
  interventions: Intervention[];
  links: InterventionBarangay[];
  statusHistory: StatusEntry[];
  dataSources: string[];
}
