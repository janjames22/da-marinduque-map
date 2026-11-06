// The same promises as tests/access-control.test.ts, kept by the hosted service: real logins, real
// tokens, real Storage and Realtime. Temporary accounts only, removed at the end.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDb, loadEnv, projectUrl, publicKey } from '../../scripts/lib/env';
import { createTestAccounts, removeTestAccounts, type TestAccount, type TestAccounts } from '../../scripts/lib/test-accounts';
import { createSupabaseBackend } from '../../src/modules/intervention-map/data/supabase-backend';
import { createSupabaseStore } from '../../src/modules/intervention-map/data/supabase-store';
import type { DataStore, InterventionValues, NewStatus } from '../../src/modules/intervention-map/data/store';
import type { MapData } from '../../src/modules/intervention-map/data/types';

const BUCKET = 'intervention-photos';
const SIGNAL_LIMIT_MS = 2000;

loadEnv();

let accounts: TestAccounts;
let visitor: SupabaseClient;
let adminClient: SupabaseClient;
let encoderClient: SupabaseClient;
let viewerClient: SupabaseClient;
let strangerClient: SupabaseClient;
let admin: DataStore;
let encoder: DataStore;
let viewer: DataStore;
let data: MapData;
let realRecordsBefore: number;

const newClient = () => createClient(projectUrl(), publicKey(), { auth: { persistSession: false, autoRefreshToken: false } });

async function signedIn(account: TestAccount): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`${account.email}: ${error.message}`);
  return client;
}

async function countRealRecords() {
  const db = await connectDb();
  try {
    return (await db.query<{ n: number }>(`select count(*)::int as n from public.interventions where beneficiary not like 'Live test%'`)).rows[0].n;
  } finally {
    await db.end();
  }
}

beforeAll(async () => {
  realRecordsBefore = await countRealRecords();
  accounts = await createTestAccounts();
  visitor = newClient();
  adminClient = await signedIn(accounts.admin);
  encoderClient = await signedIn(accounts.encoder);
  viewerClient = await signedIn(accounts.viewer);
  strangerClient = await signedIn(accounts.stranger);

  const storeFor = (client: SupabaseClient, account: TestAccount, role: 'admin' | 'encoder' | 'viewer') =>
    createSupabaseStore(createSupabaseBackend(client), { id: account.id, full_name: account.full_name, role });
  admin = storeFor(adminClient, accounts.admin, 'admin');
  encoder = storeFor(encoderClient, accounts.encoder, 'encoder');
  viewer = storeFor(viewerClient, accounts.viewer, 'viewer');
  data = await encoder.load();
  await admin.load();
  await viewer.load();
});

afterAll(async () => {
  await removeTestAccounts();
  // Proves the clean-up left the real data as it was.
  expect(await countRealRecords()).toBe(realRecordsBefore);
});

const newValues = (beneficiary: string): InterventionValues => {
  const type = data.types.find((t) => t.code === 'farm-machinery')!;
  const barangay = data.barangays.find((b) => b.name === 'Bantad')!;
  return {
    intervention_type_id: type.id,
    category_id: data.categories.find((c) => c.intervention_type_id === type.id)!.id,
    title: null,
    banner_program_id: data.programs.find((p) => p.code === 'rice')!.id,
    year_funded: 2024,
    quantity: 1,
    unit_cost: null,
    fund_source: null,
    beneficiary,
    beneficiary_type_id: null,
    municipality_id: barangay.municipality_id,
    barangay_id: barangay.id,
    location_basis_id: null,
    point: { lat: 13.45, lng: 121.85 },
    attributes: {},
    remarks: null,
  };
};

const newStatus = (changes: Partial<NewStatus> = {}): NewStatus => ({
  status_id: data.statuses.find((s) => s.name === 'Turned-over')!.id,
  status_date: '2024-05-01',
  remarks: null,
  ...changes,
});

const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'live.jpg', { type: 'image/jpeg' });

describe('reading', () => {
  it('gives visitors nothing', async () => {
    for (const table of ['interventions', 'interventions_v', 'status_history', 'audit_log', 'profiles', 'barangays', 'programs', 'intervention_photos']) {
      const { data: rows, error } = await visitor.from(table).select('*').limit(1);
      expect(error, table).not.toBeNull();
      expect(rows, table).toBeNull();
    }
    for (const fn of ['member_names', 'audit_for_intervention', 'create_intervention', 'soft_delete_intervention']) {
      const { error } = await visitor.rpc(fn, {});
      expect(error, fn).not.toBeNull();
    }
  });

  it('gives an account with no role nothing, though it can sign in', async () => {
    for (const table of ['interventions', 'interventions_v', 'status_history', 'audit_log', 'barangays', 'programs']) {
      const { data: rows, error } = await strangerClient.from(table).select('*').limit(1);
      expect(error, table).toBeNull();
      expect(rows, table).toEqual([]);
    }
  });

  it('loads the whole map for a member', () => {
    expect(data.barangays).toHaveLength(218);
    expect(data.interventions.length).toBeGreaterThanOrEqual(199);
    expect(data.statusHistory.length).toBeGreaterThanOrEqual(199);
    expect(data.dataSources).toContain('RAED 2026-10-21');
    expect(data.members.some((m) => m.full_name === 'Test viewer')).toBe(true);
  });

  it('gives geometry as GeoJSON, and no raw source row', () => {
    const located = data.interventions.find((r) => r.geojson)!;
    expect(located.geojson?.type).toBe('Point');
    expect(located).not.toHaveProperty('source_raw');
  });

  it('keeps the audit log to Admins', async () => {
    expect((await viewerClient.from('audit_log').select('id').limit(1)).data).toEqual([]);
    expect((await encoderClient.from('audit_log').select('id').limit(1)).data).toEqual([]);
    expect((await adminClient.from('audit_log').select('id').limit(1)).data).toHaveLength(1);
  });

  it('keeps other people\'s profiles to Admins', async () => {
    const own = await encoderClient.from('profiles').select('id');
    expect(own.data).toEqual([{ id: accounts.encoder.id }]);
    expect((await adminClient.from('profiles').select('id')).data!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('writing', () => {
  it('refuses a Viewer, through the functions and directly', async () => {
    const record = data.interventions[0];
    await expect(viewer.createIntervention(newValues('Live test viewer'), newStatus())).rejects.toThrow(/permission/);
    await expect(viewer.updateIntervention(record.id, record.version, { remarks: 'x' })).rejects.toThrow(/permission/);
    await expect(viewer.softDeleteIntervention(record.id, record.version)).rejects.toThrow(/permission/);
    await expect(viewer.auditFor(record.id)).rejects.toThrow(/permission/);

    const update = await viewerClient.from('interventions').update({ remarks: 'x' }).eq('id', record.id).select();
    expect(update.data ?? []).toEqual([]);
    const status = await viewerClient.from('status_history').insert({ intervention_id: record.id, status_id: record.status_id, status_date: '2024-01-01' });
    expect(status.error).not.toBeNull();
  });

  it('stops anyone making themselves Admin', async () => {
    const encoderTry = await encoderClient.from('profiles').update({ role: 'admin' }).eq('id', accounts.encoder.id).select();
    expect(encoderTry.data ?? []).toEqual([]);
    const strangerTry = await strangerClient.from('profiles').insert({ id: accounts.stranger.id, role: 'admin' });
    expect(strangerTry.error).not.toBeNull();
    const { data: profile } = await adminClient.from('profiles').select('role').eq('id', accounts.encoder.id).single();
    expect(profile?.role).toBe('encoder');
  });

  it('runs a record\'s whole life, naming the person at every step', async () => {
    const created = await encoder.createIntervention(newValues('Live test life'), newStatus(), { kind: 'create', reason: 'Live test' });
    expect(created).toMatchObject({ beneficiary: 'Live test life', version: 1, data_source: 'Encoded on the map' });
    expect(created.status_id).not.toBeNull();

    const edited = await encoder.updateIntervention(created.id, created.version, { remarks: 'Edited' }, { kind: 'edit' });
    expect(edited).toMatchObject({ remarks: 'Edited', version: 2 });

    await expect(encoder.updateIntervention(created.id, created.version, { remarks: 'Stale' })).rejects.toMatchObject({ name: 'ConflictError' });

    const deleted = await encoder.softDeleteIntervention(edited.id, edited.version, { kind: 'delete', reason: 'Live test' });
    expect(deleted.deleted_at).not.toBeNull();
    expect((await encoderClient.from('interventions').select('id').eq('id', created.id)).data).toEqual([]);
    expect((await viewerClient.from('interventions').select('id').eq('id', created.id)).data).toEqual([]);
    expect((await adminClient.from('interventions').select('id').eq('id', created.id)).data).toHaveLength(1);

    await expect(encoder.restoreIntervention(deleted.id, deleted.version)).rejects.toThrow(/permission/);
    const restored = await admin.restoreIntervention(deleted.id, deleted.version, { kind: 'restore' });
    expect(restored.deleted_at).toBeNull();

    const history = await encoder.auditFor(created.id);
    expect(history.map((h) => [h.table_name, h.action, h.actor_name])).toEqual([
      ['interventions', 'insert', 'Test encoder'],
      ['status_history', 'insert', 'Test encoder'],
      ['interventions', 'update', 'Test encoder'],
      ['interventions', 'soft_delete', 'Test encoder'],
      ['interventions', 'restore', 'Test admin'],
    ]);
    expect(history[0].context).toMatchObject({ reason: 'Live test' });

    const { data: entry } = await viewerClient.from('status_history').select('created_by').eq('intervention_id', created.id).single();
    expect(entry?.created_by).toBe(accounts.encoder.id);
  });

  it('applies the database rules on the hosted service', async () => {
    const unloaded = createSupabaseStore(createSupabaseBackend(encoderClient), { id: accounts.encoder.id, full_name: null, role: 'encoder' });
    await expect(unloaded.createIntervention({ ...newValues('Live test rule'), beneficiary: null }, newStatus())).rejects.toThrow(/beneficiary is required/);
    await expect(unloaded.createIntervention(newValues('Live test rule'), newStatus({ status_date: '2999-01-01' }))).rejects.toThrow(/future/);
    expect((await encoderClient.from('interventions').select('id').eq('beneficiary', 'Live test rule')).data).toEqual([]);
  });
});

describe('exports', () => {
  const entry = { format: 'kmz', file_name: 'Marinduque_LiveTest_2026-11-06.kmz', filters: { municipality: 'Gasan', allTypes: true }, record_count: 33 };
  const exportsBy = async (id: string) => {
    const { data: rows, error } = await adminClient.from('audit_log').select('table_name, action, actor_id, context').eq('actor_id', id).eq('action', 'export');
    expect(error).toBeNull();
    return rows;
  };
  const rpcEntry = { p_format: entry.format, p_file_name: entry.file_name, p_filters: entry.filters, p_record_count: entry.record_count };

  it('logs an export by every role: who, the format, the filters and the count', async () => {
    const roles = [
      [viewer, accounts.viewer],
      [encoder, accounts.encoder],
      [admin, accounts.admin],
    ] as const;
    for (const [store, account] of roles) {
      await store.logExport(entry);
      expect(await exportsBy(account.id), account.email).toEqual([{ table_name: 'exports', action: 'export', actor_id: account.id, context: entry }]);
    }
  });

  it('refuses visitors and accounts with no role', async () => {
    expect((await visitor.rpc('log_export', rpcEntry)).error).not.toBeNull();
    expect((await strangerClient.rpc('log_export', rpcEntry)).error).not.toBeNull();
    expect(await exportsBy(accounts.stranger.id)).toEqual([]);
  });

  it('refuses a format it doesn\'t know, and a missing count', async () => {
    await expect(viewer.logExport({ ...entry, format: 'exe' })).rejects.toThrow();
    expect((await viewerClient.rpc('log_export', { ...rpcEntry, p_record_count: null })).error).not.toBeNull();
    expect((await viewerClient.rpc('log_export', { ...rpcEntry, p_record_count: -1 })).error).not.toBeNull();
  });

  it('can\'t be written around, or written in someone else\'s name', async () => {
    const forged = { table_name: 'exports', action: 'export', actor_id: accounts.admin.id, context: entry };
    expect((await viewerClient.from('audit_log').insert(forged)).error).not.toBeNull();
    expect((await adminClient.from('audit_log').insert(forged)).error).not.toBeNull();
    expect(await exportsBy(accounts.admin.id)).toHaveLength(1);
  });
});

describe('photos', () => {
  it('stores a photo privately, and serves it through a signed link to any member', async () => {
    const record = await encoder.createIntervention(newValues('Live test photo'), newStatus({ photo: jpeg() }));
    const fresh = await viewer.load();
    const photo = fresh.photos.find((p) => p.intervention_id === record.id)!;
    expect(photo.storage_path).toMatch(new RegExp(`^${record.id}/`));

    const signed = await viewer.photoUrl(photo.id);
    expect(signed).toMatch(/token=/);
    const opened = await fetch(signed!);
    expect(opened.status).toBe(200);
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    const { data: address } = visitor.storage.from(BUCKET).getPublicUrl(photo.storage_path);
    expect((await fetch(address.publicUrl)).ok).toBe(false);
    expect((await visitor.storage.from(BUCKET).createSignedUrl(photo.storage_path, 60)).error).not.toBeNull();
    expect((await strangerClient.storage.from(BUCKET).createSignedUrl(photo.storage_path, 60)).error).not.toBeNull();

    // On a record, a file stays, even for the person who uploaded it.
    await encoderClient.storage.from(BUCKET).remove([photo.storage_path]);
    expect((await viewerClient.storage.from(BUCKET).createSignedUrl(photo.storage_path, 60)).error).toBeNull();
  });

  it('refuses uploads from Viewers and strangers, and files that aren\'t images', async () => {
    const path = `${data.interventions[0].id}/00000000-0000-4000-8000-000000000001.jpg`;
    expect((await viewerClient.storage.from(BUCKET).upload(path, jpeg())).error).not.toBeNull();
    expect((await strangerClient.storage.from(BUCKET).upload(path, jpeg())).error).not.toBeNull();
    expect((await visitor.storage.from(BUCKET).upload(path, jpeg())).error).not.toBeNull();

    const text = new File(['not a photo'], 'x.jpg', { type: 'text/plain' });
    expect((await encoderClient.storage.from(BUCKET).upload(path, text)).error).not.toBeNull();
  });

  it('refuses a file over the size limit', async () => {
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' });
    const path = `${data.interventions[0].id}/00000000-0000-4000-8000-000000000002.jpg`;
    expect((await encoderClient.storage.from(BUCKET).upload(path, huge)).error).not.toBeNull();
  });
});

describe('live signals', () => {
  const channels: SupabaseClient[] = [];

  afterAll(async () => {
    for (const client of channels) await client.removeAllChannels();
  });

  // Resolves with the channel's final state, and a way to wait for the next signal.
  async function join(client: SupabaseClient) {
    channels.push(client);
    await client.realtime.setAuth();
    let onSignal: (() => void) | null = null;
    const channel = client.channel('map-changes', { config: { private: true } });
    channel.on('broadcast', { event: 'changed' }, () => onSignal?.());
    const status = await new Promise<string>((resolve) => {
      channel.subscribe((state) => {
        if (state !== 'CLOSED') resolve(state);
      });
      setTimeout(() => resolve('TIMED_OUT'), 15_000);
    });
    return {
      status,
      nextSignal: () =>
        new Promise<number>((resolve, reject) => {
          const started = Date.now();
          const timer = setTimeout(() => reject(new Error('No signal within 10 s')), 10_000);
          onSignal = () => {
            clearTimeout(timer);
            onSignal = null;
            resolve(Date.now() - started);
          };
        }),
    };
  }

  it('reaches another person within about 2 s, for a new record and for a delete', async () => {
    const listener = await join(viewerClient);
    expect(listener.status).toBe('SUBSCRIBED');

    const waiting = listener.nextSignal();
    const record = await encoder.createIntervention(newValues('Live test signal'), newStatus());
    const onCreate = await waiting;
    console.log(`Signal after a new record: ${onCreate} ms`);
    expect(onCreate).toBeLessThan(SIGNAL_LIMIT_MS);

    // The case Realtime's table feed would miss: the row is now hidden from this Viewer.
    const waitingAgain = listener.nextSignal();
    await encoder.softDeleteIntervention(record.id, record.version);
    const onDelete = await waitingAgain;
    console.log(`Signal after a soft delete: ${onDelete} ms`);
    expect(onDelete).toBeLessThan(SIGNAL_LIMIT_MS);
  });

  it('doesn\'t let visitors or strangers listen', async () => {
    const asVisitor = await join(newClient());
    expect(asVisitor.status).not.toBe('SUBSCRIBED');
    const asStranger = await join(strangerClient);
    expect(asStranger.status).not.toBe('SUBSCRIBED');
  });

  it('doesn\'t let a member send signals of their own', async () => {
    const channel = encoderClient.channel('map-changes', { config: { private: true } });
    await new Promise((resolve) => channel.subscribe((state) => state === 'SUBSCRIBED' && resolve(null)));
    const result = await channel.httpSend('changed', { table: 'forged' }).catch((error: Error) => ({ success: false, error: error.message }));
    expect(result.success).toBe(false);
  });
});
