import type { DataStore } from './store';
import type {
  Barangay,
  Category,
  FieldSchema,
  Icon,
  Intervention,
  InterventionBarangay,
  InterventionType,
  LocationBasis,
  MapData,
  Municipality,
  Program,
  Status,
  StatusEntry,
} from './types';

// Served only by the Vite dev server (see vite.config.ts), so it can't end up in a deployed build.
const LOCAL_SEED_URL = '/__local/seed.json';

export interface LocalSeed {
  lookups: {
    icons: unknown[];
    programs: unknown[];
    categories: unknown[];
    statuses: unknown[];
    location_bases: unknown[];
    intervention_types: unknown[];
    barangay_field_schema: unknown[];
  };
  municipalities: unknown[];
  barangays: unknown[];
  interventions: unknown[];
  intervention_barangays: unknown[];
  status_history: unknown[];
  import_batches: unknown[];
}

export class LocalSeedMissingError extends Error {
  constructor() {
    super('Local dataset not found');
    this.name = 'LocalSeedMissingError';
  }
}

export function toMapData(seed: LocalSeed): MapData {
  const batches = seed.import_batches as { data_source: string }[];
  const schemaRows = seed.lookups.barangay_field_schema as { field_schema: FieldSchema }[];

  return {
    icons: seed.lookups.icons as Icon[],
    programs: seed.lookups.programs as Program[],
    categories: seed.lookups.categories as Category[],
    statuses: seed.lookups.statuses as Status[],
    locationBases: seed.lookups.location_bases as LocationBasis[],
    types: seed.lookups.intervention_types as InterventionType[],
    municipalities: seed.municipalities as Municipality[],
    barangays: seed.barangays as Barangay[],
    barangayFields: schemaRows[0]?.field_schema ?? { fields: [] },
    interventions: seed.interventions as Intervention[],
    links: seed.intervention_barangays as InterventionBarangay[],
    statusHistory: seed.status_history as StatusEntry[],
    dataSources: [...new Set(batches.map((b) => b.data_source))],
  };
}

export function createLocalStore(): DataStore {
  return {
    async load() {
      const response = await fetch(LOCAL_SEED_URL);
      if (response.status === 404) throw new LocalSeedMissingError();
      if (!response.ok) throw new Error(`Could not load local data (${response.status})`);
      return toMapData((await response.json()) as LocalSeed);
    },
  };
}
