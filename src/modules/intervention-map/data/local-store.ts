import { buildPlaceIndex, type PlaceIndex } from '../lib/qa';
import * as engine from './local-engine';
import type { EngineContext, LocalRows } from './local-engine';
import type { DataStore, NewStatus, PhotoMeta } from './store';
import type {
  AuditEntry,
  Barangay,
  BeneficiaryType,
  Category,
  FieldSchema,
  Icon,
  Intervention,
  InterventionBarangay,
  InterventionPhoto,
  InterventionType,
  LocationBasis,
  MapData,
  Municipality,
  Program,
  Status,
  StatusEntry,
  TypeStatus,
} from './types';
import { readPhotoMeta } from '../lib/photo-meta';

// Served only by the Vite dev server (see vite.config.ts), so it can't end up in a deployed build.
const LOCAL_SEED_URL = '/__local/seed.json';
const DB_NAME = 'da-intervention-map-local';
const STATE_KEY = 'current';
const CHANNEL_NAME = 'da-intervention-map-local';

export interface LocalSeed {
  lookups: {
    icons: unknown[];
    programs: unknown[];
    categories: unknown[];
    statuses: unknown[];
    location_bases: unknown[];
    beneficiary_types: unknown[];
    intervention_types: unknown[];
    intervention_type_statuses: unknown[];
    barangay_field_schema: unknown[];
  };
  municipalities: unknown[];
  barangays: unknown[];
  interventions: unknown[];
  intervention_barangays: unknown[];
  status_history: unknown[];
  import_batches: unknown[];
  audit_log?: unknown[];
}

export class LocalSeedMissingError extends Error {
  constructor() {
    super('Local dataset not found');
    this.name = 'LocalSeedMissingError';
  }
}

const bySortOrder = <T extends { sort_order: number }>(items: T[]) => [...items].sort((a, b) => a.sort_order - b.sort_order);

export function toMapData(seed: LocalSeed): MapData {
  const batches = seed.import_batches as { data_source: string }[];
  const schemaRows = seed.lookups.barangay_field_schema as { field_schema: FieldSchema }[];

  return {
    icons: seed.lookups.icons as Icon[],
    programs: seed.lookups.programs as Program[],
    categories: bySortOrder(seed.lookups.categories as Category[]),
    statuses: seed.lookups.statuses as Status[],
    locationBases: bySortOrder(seed.lookups.location_bases as LocationBasis[]),
    beneficiaryTypes: bySortOrder((seed.lookups.beneficiary_types ?? []) as BeneficiaryType[]),
    types: seed.lookups.intervention_types as InterventionType[],
    typeStatuses: bySortOrder((seed.lookups.intervention_type_statuses ?? []) as TypeStatus[]),
    municipalities: seed.municipalities as Municipality[],
    barangays: seed.barangays as Barangay[],
    barangayFields: schemaRows[0]?.field_schema ?? { fields: [] },
    interventions: seed.interventions as Intervention[],
    links: seed.intervention_barangays as InterventionBarangay[],
    statusHistory: seed.status_history as StatusEntry[],
    photos: [],
    dataSources: [...new Set(batches.map((b) => b.data_source))],
  };
}

// The parts of a saved state that never change while the app runs, and the rows that do.
type FixedData = Omit<MapData, 'interventions' | 'links' | 'statusHistory' | 'barangays' | 'photos'>;

export interface LocalState {
  fingerprint: string;
  fixed: FixedData;
  rows: LocalRows;
}

export function stateFromSeed(seed: LocalSeed, fingerprint: string): LocalState {
  const { interventions, links, statusHistory, barangays, photos, ...fixed } = toMapData(seed);
  return {
    fingerprint,
    fixed,
    rows: {
      interventions,
      links,
      statusHistory,
      barangays,
      photos,
      auditLog: (seed.audit_log ?? []) as AuditEntry[],
      changeCount: 0,
    },
  };
}

function fingerprintOf(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}-${(hash >>> 0).toString(16)}`;
}

// crypto.randomUUID only exists on https and localhost, and phones reach the dev server over plain http.
export function newUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('photos');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface StoredPhoto {
  type: string;
  bytes: ArrayBuffer;
}

export interface LocalStoreOptions {
  boundaries: { barangays: GeoJSON.FeatureCollection; municipalities: GeoJSON.FeatureCollection };
}

export async function createLocalStore({ boundaries }: LocalStoreOptions): Promise<DataStore> {
  const response = await fetch(LOCAL_SEED_URL);
  if (response.status === 404) throw new LocalSeedMissingError();
  if (!response.ok) throw new Error(`Could not load local data (${response.status})`);
  const seedText = await response.text();
  const seedFingerprint = fingerprintOf(seedText);

  const db = await openDatabase();
  const listeners = new Set<() => void>();
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = () => listeners.forEach((listener) => listener());

  const notifyAll = () => {
    listeners.forEach((listener) => listener());
    channel.postMessage('changed');
  };

  const readState = () =>
    new Promise<LocalState | undefined>((resolve, reject) => {
      const request = db.transaction('state').objectStore('state').get(STATE_KEY);
      request.onsuccess = () => resolve(request.result as LocalState | undefined);
      request.onerror = () => reject(request.error);
    });

  const writeState = (state: LocalState) =>
    new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['state', 'photos'], 'readwrite');
      transaction.objectStore('state').put(state, STATE_KEY);
      transaction.objectStore('photos').clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

  const freshState = () => stateFromSeed(JSON.parse(seedText) as LocalSeed, seedFingerprint);

  // A rebuilt seed replaces the saved data only if nothing was changed here. Otherwise it waits
  // until the user chooses, because the rebuilt seed's record ids don't match the saved ones.
  let saved: LocalState;
  const existing = await readState();
  if (!existing || (existing.fingerprint !== seedFingerprint && existing.rows.changeCount === 0)) {
    saved = freshState();
    await writeState(saved);
  } else {
    saved = existing;
  }

  const places: PlaceIndex = buildPlaceIndex(boundaries, { barangays: saved.rows.barangays, municipalities: saved.fixed.municipalities });

  const contextFor = (state: LocalState): EngineContext => ({
    types: state.fixed.types,
    categories: state.fixed.categories,
    typeStatuses: state.fixed.typeStatuses,
    municipalities: state.fixed.municipalities,
    barangayFields: state.fixed.barangayFields,
    places,
    now: () => new Date().toISOString(),
    newId: newUuid,
  });

  // One transaction reads, changes and writes the state, so two tabs can't overwrite each other.
  // Nothing inside the callback may wait on anything else, or the transaction would close early.
  const mutate = <T>(change: (rows: LocalRows, context: EngineContext, photos: IDBObjectStore) => T) =>
    new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(['state', 'photos'], 'readwrite');
      const states = transaction.objectStore('state');
      let result: T;
      let failure: unknown = null;

      const request = states.get(STATE_KEY);
      request.onsuccess = () => {
        const state = request.result as LocalState;
        try {
          result = change(state.rows, contextFor(state), transaction.objectStore('photos'));
          state.rows.changeCount += 1;
          states.put(state, STATE_KEY);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        resolve(result);
        notifyAll();
      };
      transaction.onabort = () => reject(failure ?? transaction.error);
      transaction.onerror = () => reject(failure ?? transaction.error);
    });

  return {
    async load() {
      const state = await readState();
      if (!state) throw new LocalSeedMissingError();
      const { interventions, links, statusHistory, barangays, photos } = state.rows;
      return { ...state.fixed, interventions, links, statusHistory, barangays, photos };
    },

    createIntervention(values, status, note) {
      return prepareStatus(status).then((prepared) =>
        mutate((rows, context, photos) => {
          const record = engine.createIntervention(rows, context, values, note);
          addStatusWithPhoto(rows, context, photos, record.id, status, prepared, note);
          return record;
        }),
      );
    },

    updateIntervention(id, expectedVersion, patch, note) {
      return mutate((rows, context) => engine.updateIntervention(rows, context, id, expectedVersion, patch, note));
    },

    softDeleteIntervention(id, expectedVersion, note) {
      return mutate((rows, context) => engine.softDeleteIntervention(rows, context, id, expectedVersion, note));
    },

    restoreIntervention(id, expectedVersion, note) {
      return mutate((rows, context) => engine.restoreIntervention(rows, context, id, expectedVersion, note));
    },

    addStatus(interventionId, status, note) {
      return prepareStatus(status).then((prepared) =>
        mutate((rows, context, photos) => addStatusWithPhoto(rows, context, photos, interventionId, status, prepared, note)),
      );
    },

    updateBarangayBaseline(id, expectedVersion, attributes, note) {
      return mutate((rows, context) => engine.updateBarangayBaseline(rows, context, id, expectedVersion, attributes, note));
    },

    async auditFor(interventionId) {
      const state = await readState();
      return state ? engine.auditForRecord(state.rows.auditLog, interventionId) : [];
    },

    photoUrl(photoId) {
      return new Promise((resolve, reject) => {
        const request = db.transaction('photos').objectStore('photos').get(photoId);
        request.onsuccess = () => {
          const stored = request.result as StoredPhoto | undefined;
          resolve(stored ? URL.createObjectURL(new Blob([stored.bytes], { type: stored.type })) : null);
        };
        request.onerror = () => reject(request.error);
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    local: {
      async changeCount() {
        return (await readState())?.rows.changeCount ?? 0;
      },
      newerSeedAvailable: () => saved.fingerprint !== seedFingerprint,
      async reset() {
        saved = freshState();
        await writeState(saved);
        notifyAll();
      },
    },
  };
}

// Reading a file takes time, so it happens before the transaction opens.
async function prepareStatus(status: NewStatus): Promise<{ stored: StoredPhoto; meta: PhotoMeta } | null> {
  if (!status.photo) return null;
  const [bytes, meta] = await Promise.all([status.photo.arrayBuffer(), readPhotoMeta(status.photo)]);
  return { stored: { type: status.photo.type, bytes }, meta };
}

function addStatusWithPhoto(
  rows: LocalRows,
  context: EngineContext,
  photos: IDBObjectStore,
  interventionId: string,
  status: NewStatus,
  prepared: { stored: StoredPhoto; meta: PhotoMeta } | null,
  note?: Parameters<DataStore['addStatus']>[2],
) {
  let photoId: string | null = null;
  if (prepared) {
    const photo: InterventionPhoto = engine.addPhoto(rows, context, interventionId, prepared.meta, note);
    photos.put(prepared.stored, photo.id);
    photoId = photo.id;
  }
  return engine.addStatus(rows, context, interventionId, { ...status, photo_id: photoId }, note);
}
