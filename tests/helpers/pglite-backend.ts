import type { PGlite } from '@electric-sql/pglite';
import { BackendError, type SupabaseBackend } from '../../src/modules/intervention-map/data/supabase-store';

// Does what the hosted service does for the store: runs each call in its own transaction, as the
// logged-in user, under row-level security. Only storage is pretended, as files in a map.
export interface PgliteBackend extends SupabaseBackend {
  files: Map<string, Blob>;
  failNextUpload: boolean;
}

export function createPgliteBackend(db: PGlite, userId: string): PgliteBackend {
  async function asUser<T>(work: () => Promise<T>): Promise<T> {
    await db.exec('begin');
    try {
      await db.exec('set local role authenticated');
      await db.query(`select set_config('request.jwt.sub', $1, true)`, [userId]);
      const result = await work();
      await db.exec('commit');
      return result;
    } catch (error) {
      await db.exec('rollback');
      const failure = error as { code?: string; message: string };
      throw new BackendError(failure.code ?? 'unknown', failure.message);
    }
  }

  const files = new Map<string, Blob>();
  const backend: PgliteBackend = {
    files,
    failNextUpload: false,

    rpc<T>(name: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const named = keys.map((key, i) => `${key} => $${i + 1}`).join(', ');
      const params = keys.map((key) => {
        const value = args[key];
        return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
      });
      return asUser(async () => {
        // Sets come back as rows and single values as themselves, as they do through the API.
        const { rows } = await db.query<{ value: unknown }>(`select to_jsonb(r) as value from public.${name}(${named}) r`, params);
        const values = rows.map((row) => row.value) as { r?: unknown }[];
        const isScalar = name !== 'audit_for_intervention' && name !== 'member_names';
        return (isScalar ? values[0] : values) as T;
      });
    },

    selectAll<T>(table: string, columns: string, orderBy: string[]) {
      return asUser(async () => {
        // to_jsonb gives dates and geometry in the same form as the API.
        const { rows } = await db.query<{ row: T }>(
          `select to_jsonb(x) as row from (select ${columns} from public.${table} order by ${orderBy.join(', ')}) x`,
        );
        return rows.map((row) => row.row);
      });
    },

    insertRow(table: string, values: Record<string, unknown>) {
      const keys = Object.keys(values);
      return asUser(async () => {
        await db.query(
          `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
          keys.map((key) => values[key]),
        );
      });
    },

    deleteRow(table: string, id: string) {
      return asUser(async () => {
        const { affectedRows } = await db.query(`delete from public.${table} where id = $1`, [id]);
        if (!affectedRows) throw Object.assign(new Error('Nothing was changed.'), { code: '42501' });
      });
    },

    updateRow(table: string, id: number | string, values: Record<string, unknown>) {
      const keys = Object.keys(values);
      return asUser(async () => {
        const { affectedRows } = await db.query(
          `update public.${table} set ${keys.map((key, i) => `${key} = $${i + 1}`).join(', ')} where id = $${keys.length + 1}`,
          [...keys.map((key) => values[key]), id],
        );
        if (!affectedRows) throw Object.assign(new Error('Nothing was changed.'), { code: '42501' });
      });
    },

    selectById<T>(table: string, columns: string, id: string | number) {
      return asUser(async () => {
        const { rows } = await db.query<{ row: T }>(`select to_jsonb(x) as row from (select ${columns} from public.${table} where id = $1) x`, [id]);
        return rows[0]?.row ?? null;
      });
    },

    async uploadPhoto(path, file) {
      if (backend.failNextUpload) {
        backend.failNextUpload = false;
        throw new BackendError('', 'The photo could not be uploaded: network error');
      }
      files.set(path, file);
    },

    async removePhoto(path) {
      files.delete(path);
    },

    async signedPhotoUrl(path) {
      return files.has(path) ? `https://storage.test/${path}?token=signed` : null;
    },

    watch() {
      return () => {};
    },
  };
  return backend;
}
