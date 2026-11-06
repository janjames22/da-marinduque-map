import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConnectionListener } from './store';
import { BackendError, type SupabaseBackend } from './supabase-store';

const PHOTO_BUCKET = 'intervention-photos';
const CHANGE_TOPIC = 'map-changes';
const PAGE_SIZE = 1000;
const SIGNED_URL_SECONDS = 60 * 60;
// One save sends several signals, and a burst of them should cause one reload.
const CHANGE_DELAY_MS = 300;

const toBackendError = (error: { code?: string; message: string }) => new BackendError(error.code ?? '', error.message);

export function createSupabaseBackend(client: SupabaseClient): SupabaseBackend {
  return {
    async rpc<T>(name: string, args: Record<string, unknown>) {
      const { data, error } = await client.rpc(name, args);
      if (error) throw toBackendError(error);
      return data as T;
    },

    async selectAll<T>(table: string, columns: string, orderBy: string[]) {
      const rows: T[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        let query = client.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
        for (const column of orderBy) query = query.order(column);
        const { data, error } = await query;
        if (error) throw toBackendError(error);
        rows.push(...(data as T[]));
        if (data.length < PAGE_SIZE) return rows;
      }
    },

    async selectById<T>(table: string, columns: string, id: string | number) {
      const { data, error } = await client.from(table).select(columns).eq('id', id).maybeSingle();
      if (error) throw toBackendError(error);
      return data as T | null;
    },

    async uploadPhoto(path, file, contentType) {
      const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, file, { contentType, upsert: false });
      if (error) throw new BackendError('', `The photo could not be uploaded: ${error.message}`);
    },

    async removePhoto(path) {
      await client.storage.from(PHOTO_BUCKET).remove([path]);
    },

    async signedPhotoUrl(path) {
      const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
      if (error) throw new BackendError('', `The photo could not be opened: ${error.message}`);
      return data.signedUrl;
    },

    watch(onChange, onConnection: ConnectionListener) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, CHANGE_DELAY_MS);
      };

      let stopped = false;
      let wasLive = true;
      const channel = client.channel(CHANGE_TOPIC, { config: { private: true } });
      channel.on('broadcast', { event: 'changed' }, changed);

      // Private channels check the login, so the socket needs the token before joining.
      void client.realtime.setAuth().then(() => {
        if (stopped) return;
        channel.subscribe((status) => {
          const live = status === 'SUBSCRIBED';
          onConnection(live);
          // Anything sent while disconnected is gone, so catch up on returning.
          if (live && !wasLive) changed();
          wasLive = live;
        });
      });

      // Phones suspend the page and its socket, and signals sent meanwhile aren't replayed.
      const onVisible = () => {
        if (document.visibilityState === 'visible') changed();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', changed);

      return () => {
        stopped = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', changed);
        void client.removeChannel(channel);
      };
    },
  };
}
