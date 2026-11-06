// The DataStore for Supabase. Everything that talks to the service is in the backend passed in, so
// tests can run this file against the real database functions. The database makes every decision;
// the checks here only let a form point at the exact field instead of showing a database message.
import { valuesFromRecord } from '../lib/form-values';
import { readPhotoMeta } from '../lib/photo-meta';
import { newUuid } from '../lib/uuid';
import { validateAttributes, validateIntervention, validateStatus } from '../lib/validation';
import { ConflictError, ValidationError, type ChangeNote, type ConnectionListener, type DataStore, type NewStatus } from './store';
import type {
  AppUser,
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
  Member,
  Municipality,
  Program,
  Status,
  StatusEntry,
  TypeStatus,
} from './types';

export class BackendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
  }
}

export interface SupabaseBackend {
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
  // Every matching row, in a fixed order. A plain select stops at the service's row limit.
  selectAll<T>(table: string, columns: string, orderBy: string[]): Promise<T[]>;
  selectById<T>(table: string, columns: string, id: string | number): Promise<T | null>;
  uploadPhoto(path: string, file: Blob, contentType: string): Promise<void>;
  removePhoto(path: string): Promise<void>;
  signedPhotoUrl(path: string): Promise<string | null>;
  // Calls onChange when anything may have changed elsewhere, and onConnection as live updates stop and resume.
  watch(onChange: () => void, onConnection: ConnectionListener): () => void;
}

const INTERVENTION_COLUMNS =
  'id,source_id,source_page,intervention_type_id,category_id,title,banner_program_id,year_funded,quantity,unit_cost,fund_source,beneficiary,' +
  'beneficiary_type_id,municipality_id,barangay_id,barangay_raw,location_basis_id,status_id,attributes,remarks,data_source,' +
  'qa_flags,geojson,plotted_barangay_id,plotted_barangay,plotted_municipality,version,created_by,updated_by,created_at,updated_at,deleted_at';
const BARANGAY_COLUMNS = 'id,municipality_id,name,psgc_code,attributes,version';

const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Some phones give a picked file no type, so the file name has to say what it is.
export function photoFileType(file: { name?: string; type: string }): { extension: string; contentType: string } {
  const known = PHOTO_EXTENSIONS[file.type];
  if (known) return { extension: known, contentType: file.type };
  const fromName = file.name?.split('.').pop()?.toLowerCase() ?? '';
  const match = Object.entries(PHOTO_EXTENSIONS).find(([, extension]) => extension === fromName || (fromName === 'jpeg' && extension === 'jpg'));
  return match ? { extension: match[1], contentType: match[0] } : { extension: 'jpg', contentType: 'image/jpeg' };
}

export function friendlyError(error: unknown): Error {
  if (!(error instanceof BackendError)) return error as Error;
  if (error.code === '42501') return new Error('Your account doesn\'t have permission to do that.');
  if (error.code === '' || /fetch|network/i.test(error.message)) {
    return new Error('No connection, so nothing was saved. Try again once you\'re back online.');
  }
  return new Error(error.message);
}

export function createSupabaseStore(backend: SupabaseBackend, user: AppUser): DataStore {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let loaded: MapData | null = null;

  const latestRecord = (id: string) => backend.selectById<Intervention>('interventions_v', INTERVENTION_COLUMNS, id).catch(() => null);

  // A version conflict needs the newest row, so the form can show what changed.
  async function call<T>(name: string, args: Record<string, unknown>, latest?: () => Promise<Intervention | Barangay | null>): Promise<T> {
    try {
      return await backend.rpc<T>(name, args);
    } catch (error) {
      if (error instanceof BackendError && error.code === 'DA409') throw new ConflictError(latest ? await latest() : null);
      throw friendlyError(error);
    }
  }

  async function uploadPhoto(interventionId: string, status: NewStatus) {
    if (!status.photo) return null;
    const { extension, contentType } = photoFileType(status.photo);
    const id = newUuid();
    const path = `${interventionId}/${id}.${extension}`;
    const meta = await readPhotoMeta(status.photo);
    try {
      await backend.uploadPhoto(path, status.photo, contentType);
    } catch (error) {
      throw friendlyError(error);
    }
    return { id, storage_path: path, taken_at: meta.taken_at, exif_location: meta.exif_location };
  }

  // The file goes up first, since a record pointing at a missing file would be worse than the
  // reverse. If the save then fails, the file is removed, and a failure there leaves only a file
  // nothing points to.
  async function savingWithPhoto<T>(photo: { storage_path: string } | null, save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (photo) void backend.removePhoto(photo.storage_path).catch(() => {});
      throw error;
    }
  }

  const statusArgs = ({ status_id, status_date, remarks }: NewStatus) => ({ status_id, status_date, remarks });
  const noteArg = (note?: ChangeNote) => note ?? null;

  const store: DataStore = {
    user,

    async load() {
      const all = <T>(table: string, columns = '*', orderBy = ['id']) => backend.selectAll<T>(table, columns, orderBy);
      const [
        icons,
        programs,
        categories,
        statuses,
        locationBases,
        beneficiaryTypes,
        types,
        typeStatuses,
        municipalities,
        barangays,
        schemaRows,
        interventions,
        links,
        statusHistory,
        photos,
        batches,
        members,
      ] = await Promise.all([
        all<Icon>('icons'),
        all<Program>('programs'),
        all<Category>('categories', '*', ['sort_order', 'id']),
        all<Status>('statuses'),
        all<LocationBasis>('location_bases', '*', ['sort_order', 'id']),
        all<BeneficiaryType>('beneficiary_types', '*', ['sort_order', 'id']),
        all<InterventionType>('intervention_types'),
        all<TypeStatus>('intervention_type_statuses', '*', ['sort_order', 'intervention_type_id', 'status_id']),
        all<Municipality>('municipalities', 'id,name,psgc_code', ['name']),
        all<Barangay>('barangays', BARANGAY_COLUMNS, ['name', 'id']),
        all<{ field_schema: FieldSchema }>('barangay_field_schema', 'field_schema', ['id']),
        all<Intervention>('interventions_v', INTERVENTION_COLUMNS),
        all<InterventionBarangay>('intervention_barangays', '*', ['intervention_id', 'barangay_id']),
        all<StatusEntry>(
          'status_history',
          'id,intervention_id,status_id,status_date,date_basis,source_note,remarks,photo_id,created_by,created_at',
          ['status_date', 'created_at', 'id'],
        ),
        all<InterventionPhoto>('intervention_photos', 'id,intervention_id,storage_path,caption,taken_at,exif_location,created_at'),
        all<{ data_source: string }>('import_batches', 'data_source', ['imported_at', 'id']),
        backend.rpc<Member[]>('member_names', {}),
      ]);

      loaded = {
        icons,
        programs,
        categories,
        statuses,
        locationBases,
        beneficiaryTypes,
        types,
        typeStatuses,
        municipalities,
        barangays,
        barangayFields: schemaRows[0]?.field_schema ?? { fields: [] },
        interventions,
        links,
        statusHistory,
        photos,
        dataSources: [...new Set(batches.map((batch) => batch.data_source))],
        members,
      };
      return loaded;
    },

    async logExport({ format, file_name, filters, record_count }) {
      await call('log_export', { p_format: format, p_file_name: file_name, p_filters: filters, p_record_count: record_count });
    },

    async createIntervention(values, status, note) {
      if (loaded) {
        const type = loaded.types.find((t) => t.id === values.intervention_type_id);
        if (type) {
          const errors = {
            ...validateIntervention(values, null, { type, categories: loaded.categories, barangays: loaded.barangays }),
            ...validateStatus(status, type.id, loaded.typeStatuses),
          };
          if (Object.keys(errors).length > 0) throw new ValidationError(errors);
        }
      }

      const id = newUuid();
      const photo = await uploadPhoto(id, status);
      const saved = await savingWithPhoto(photo, () =>
        call<Intervention>('create_intervention', {
          p_values: { ...values, id },
          p_status: statusArgs(status),
          p_photo: photo,
          p_note: noteArg(note),
        }),
      );
      notify();
      return saved;
    },

    async updateIntervention(id, expectedVersion, patch, note) {
      const record = loaded?.interventions.find((r) => r.id === id);
      const type = loaded?.types.find((t) => t.id === record?.intervention_type_id);
      if (loaded && record && type) {
        const { clear_name_check: _clear, ...columns } = patch;
        const previous = valuesFromRecord(record);
        const errors = validateIntervention({ ...previous, ...columns }, previous, {
          type,
          categories: loaded.categories,
          barangays: loaded.barangays,
        });
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      }

      const saved = await call<Intervention>(
        'update_intervention',
        { p_id: id, p_expected_version: expectedVersion, p_patch: patch, p_note: noteArg(note) },
        () => latestRecord(id),
      );
      notify();
      return saved;
    },

    async softDeleteIntervention(id, expectedVersion, note) {
      const saved = await call<Intervention>(
        'soft_delete_intervention',
        { p_id: id, p_expected_version: expectedVersion, p_note: noteArg(note) },
        () => latestRecord(id),
      );
      notify();
      return saved;
    },

    async restoreIntervention(id, expectedVersion, note) {
      const saved = await call<Intervention>(
        'restore_intervention',
        { p_id: id, p_expected_version: expectedVersion, p_note: noteArg(note) },
        () => latestRecord(id),
      );
      notify();
      return saved;
    },

    async addStatus(interventionId, status, note) {
      const record = loaded?.interventions.find((r) => r.id === interventionId);
      if (loaded && record) {
        const errors = validateStatus(status, record.intervention_type_id, loaded.typeStatuses);
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      }

      const photo = await uploadPhoto(interventionId, status);
      const saved = await savingWithPhoto(photo, () =>
        call<StatusEntry>('add_status', {
          p_intervention_id: interventionId,
          p_status: statusArgs(status),
          p_photo: photo,
          p_note: noteArg(note),
        }),
      );
      notify();
      return saved;
    },

    async updateBarangayBaseline(id, expectedVersion, attributes, note) {
      if (loaded) {
        const errors = validateAttributes(loaded.barangayFields, attributes);
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      }
      const saved = await call<Barangay>(
        'update_barangay_baseline',
        { p_id: id, p_expected_version: expectedVersion, p_attributes: attributes, p_note: noteArg(note) },
        () => backend.selectById<Barangay>('barangays', BARANGAY_COLUMNS, id).catch(() => null),
      );
      notify();
      return saved;
    },

    auditFor(interventionId) {
      return call<AuditEntry[]>('audit_for_intervention', { p_id: interventionId });
    },

    async photoUrl(photoId) {
      const known = loaded?.photos.find((photo) => photo.id === photoId);
      const path = known?.storage_path ?? (await backend.selectById<InterventionPhoto>('intervention_photos', 'storage_path', photoId))?.storage_path;
      return path ? backend.signedPhotoUrl(path) : null;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    watchConnection(listener) {
      return backend.watch(notify, listener);
    },
  };

  return store;
}
