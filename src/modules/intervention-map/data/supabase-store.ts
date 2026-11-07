// The DataStore for Supabase. Everything that talks to the service is in the backend passed in, so
// tests can run this file against the real database functions. The database makes every decision;
// the checks here only let a form point at the exact field instead of showing a database message.
import { fieldSchemaChangeProblem, fieldSchemaProblem, validateLookup, validateTypeChange, type LookupRules } from '../lib/admin-rules';
import { valuesFromRecord } from '../lib/form-values';
import { readPhotoMeta } from '../lib/photo-meta';
import { newUuid } from '../lib/uuid';
import { validateAttributes, validateIntervention, validateStatus } from '../lib/validation';
import {
  ConflictError,
  ValidationError,
  type ChangeNote,
  type ConnectionListener,
  type DataStore,
  type LookupTable,
  type NewStatus,
  type PeopleApi,
  type Person,
} from './store';
import type {
  AppUser,
  AuditEntry,
  Barangay,
  BeneficiaryType,
  Category,
  CategoryGroup,
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
  insertRow(table: string, values: Record<string, unknown>): Promise<void>;
  updateRow(table: string, id: number, values: Record<string, unknown>): Promise<void>;
  // Things only a server can do, as they take the project's secret key.
  invokeFunction?<T>(name: string, body: Record<string, unknown>): Promise<T>;
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
  if (error.code === '23505') return new Error('That name is already used.');
  if (error.code === '' || /fetch|network/i.test(error.message)) {
    return new Error('No connection, so nothing was saved. Try again once you\'re back online.');
  }
  return new Error(error.message);
}

// What each list holds, so a save can point at the exact field.
const LOOKUP_RULES: Record<LookupTable, LookupRules> = {
  programs: { needsColor: true },
  categories: {},
  category_groups: {},
  statuses: { needsColor: true },
  beneficiary_types: {},
  location_bases: { needsColor: true },
  icons: { isIcon: true },
};

const LOOKUP_ROWS: Record<LookupTable, keyof MapData> = {
  programs: 'programs',
  categories: 'categories',
  category_groups: 'categoryGroups',
  statuses: 'statuses',
  beneficiary_types: 'beneficiaryTypes',
  location_bases: 'locationBases',
  icons: 'icons',
};

function createPeopleApi(backend: SupabaseBackend): PeopleApi | undefined {
  const invoke = backend.invokeFunction?.bind(backend);
  if (!invoke) return undefined;
  const call = async <T>(body: Record<string, unknown>) => {
    try {
      // Where a link should land. Auth checks it against the project's allowed addresses.
      return await invoke<T>('admin-users', { ...body, redirect_to: globalThis.location?.origin });
    } catch (error) {
      throw friendlyError(error);
    }
  };
  return {
    list: async () => (await call<{ people: Person[] }>({ action: 'list' })).people,
    invite: (input) => call<{ link: string | null }>({ action: 'invite', ...input }),
    newLink: (id, delivery) => call<{ link: string | null }>({ action: 'new_link', id, delivery }),
    update: async (id, changes) => {
      await call({ action: 'update', id, ...changes });
    },
    deactivate: async (id) => {
      await call({ action: 'deactivate', id });
    },
    reactivate: async (id) => {
      await call({ action: 'reactivate', id });
    },
  };
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

  async function uploadFile(interventionId: string, file: File) {
    const { extension, contentType } = photoFileType(file);
    const id = newUuid();
    const path = `${interventionId}/${id}.${extension}`;
    const meta = await readPhotoMeta(file);
    try {
      await backend.uploadPhoto(path, file, contentType);
    } catch (error) {
      throw friendlyError(error);
    }
    return { id, storage_path: path, taken_at: meta.taken_at, exif_location: meta.exif_location };
  }

  const uploadPhoto = (interventionId: string, status: NewStatus) => (status.photo ? uploadFile(interventionId, status.photo) : Promise.resolve(null));

  const removeFiles = (photos: { storage_path: string }[]) => {
    for (const photo of photos) void backend.removePhoto(photo.storage_path).catch(() => {});
  };

  // The file goes up first, since a record pointing at a missing file would be worse than the
  // reverse. If the save then fails, the file is removed, and a failure there leaves only a file
  // nothing points to.
  async function savingWithPhotos<T>(photos: ({ storage_path: string } | null)[], save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      removeFiles(photos.filter((photo) => photo !== null));
      throw error;
    }
  }

  // Each new file for a photo field, with its field's label as the caption, and the attributes
  // holding the photo's id in place of PENDING_PHOTO.
  async function uploadFieldPhotos(interventionId: string, typeId: number | undefined, files: Record<string, File> | undefined, attributes: Record<string, unknown> | undefined) {
    const schema = loaded?.types.find((t) => t.id === typeId)?.field_schema;
    const uploaded: (Awaited<ReturnType<typeof uploadFile>> & { caption: string | null })[] = [];
    const withIds = attributes ? { ...attributes } : undefined;
    try {
      for (const [key, file] of Object.entries(files ?? {})) {
        const photo = await uploadFile(interventionId, file);
        uploaded.push({ ...photo, caption: schema?.fields.find((field) => field.key === key)?.label ?? null });
        if (withIds) withIds[key] = photo.id;
      }
    } catch (error) {
      removeFiles(uploaded);
      throw error;
    }
    return { uploaded, attributes: withIds };
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
        categoryGroups,
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
        all<Program>('programs', '*', ['sort_order', 'id']),
        all<CategoryGroup>('category_groups', '*', ['sort_order', 'id']),
        all<Category>('categories', '*', ['sort_order', 'id']),
        all<Status>('statuses', '*', ['sort_order', 'id']),
        all<LocationBasis>('location_bases', '*', ['sort_order', 'id']),
        all<BeneficiaryType>('beneficiary_types', '*', ['sort_order', 'id']),
        all<InterventionType>('intervention_types', '*', ['sort_order', 'id']),
        all<TypeStatus>('intervention_type_statuses', '*', ['sort_order', 'intervention_type_id', 'status_id']),
        all<Municipality>('municipalities', 'id,name,psgc_code', ['name']),
        all<Barangay>('barangays', BARANGAY_COLUMNS, ['name', 'id']),
        all<{ field_schema: FieldSchema; version: number }>('barangay_field_schema', 'field_schema,version', ['id']),
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
        categoryGroups,
        categories,
        statuses,
        locationBases,
        beneficiaryTypes,
        types,
        typeStatuses,
        municipalities,
        barangays,
        barangayFields: schemaRows[0]?.field_schema ?? { fields: [] },
        barangayFieldsVersion: schemaRows[0]?.version ?? 1,
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
      const { field_photos: files, ...columns } = values;
      const fieldPhotos = await uploadFieldPhotos(id, values.intervention_type_id, files, values.attributes);
      let photo: Awaited<ReturnType<typeof uploadPhoto>>;
      try {
        photo = await uploadPhoto(id, status);
      } catch (error) {
        removeFiles(fieldPhotos.uploaded);
        throw error;
      }
      const saved = await savingWithPhotos([photo, ...fieldPhotos.uploaded], () =>
        call<Intervention>('create_intervention', {
          p_values: {
            ...columns,
            id,
            attributes: fieldPhotos.attributes,
            ...(fieldPhotos.uploaded.length > 0 ? { field_photos: fieldPhotos.uploaded } : {}),
          },
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
        const { clear_name_check: _clear, field_photos: _files, ...columns } = patch;
        const previous = valuesFromRecord(record);
        const errors = validateIntervention({ ...previous, ...columns }, previous, {
          type,
          categories: loaded.categories,
          barangays: loaded.barangays,
        });
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      }

      const { field_photos: files, ...changes } = patch;
      const fieldPhotos = await uploadFieldPhotos(id, record?.intervention_type_id, files, patch.attributes);
      const saved = await savingWithPhotos(fieldPhotos.uploaded, () =>
        call<Intervention>(
          'update_intervention',
          {
            p_id: id,
            p_expected_version: expectedVersion,
            p_patch: {
              ...changes,
              ...(fieldPhotos.attributes ? { attributes: fieldPhotos.attributes } : {}),
              ...(fieldPhotos.uploaded.length > 0 ? { field_photos: fieldPhotos.uploaded } : {}),
            },
            p_note: noteArg(note),
          },
          () => latestRecord(id),
        ),
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
      const saved = await savingWithPhotos([photo], () =>
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

    async saveLookup(table, id, values) {
      if (loaded) {
        const rows = loaded[LOOKUP_ROWS[table]] as unknown as { id: number; name: string; color?: string; image?: string }[];
        const current = rows.find((row) => row.id === id);
        const errors = validateLookup({ ...current, ...values }, rows, id, LOOKUP_RULES[table]);
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      }
      try {
        if (id === null) await backend.insertRow(table, { ...values });
        else await backend.updateRow(table, id, { ...values });
      } catch (error) {
        throw friendlyError(error);
      }
      notify();
    },

    async saveType(id, expectedVersion, values, statuses) {
      if (loaded) {
        const errors = validateTypeChange(id, values, statuses, loaded);
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      }
      const saved = await call<InterventionType>(
        'save_intervention_type',
        { p_id: id, p_expected_version: expectedVersion, p_values: values, p_statuses: statuses, p_note: { kind: 'admin' } },
      );
      notify();
      return saved;
    },

    async saveBarangayFields(expectedVersion, schema) {
      const problem = fieldSchemaProblem(schema) ?? (loaded ? fieldSchemaChangeProblem(loaded.barangayFields, schema) : null);
      if (problem) throw new ValidationError({ field_schema: problem });
      await call('save_barangay_fields', { p_expected_version: expectedVersion, p_schema: schema, p_note: { kind: 'admin' } });
      notify();
    },

    people: createPeopleApi(backend),

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
