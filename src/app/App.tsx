import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { dataMode } from '../modules/intervention-map/data/app-config';
import { localUser } from '../modules/intervention-map/data/create-store';
import type { AppUser } from '../modules/intervention-map/data/types';
import { ROLE_LABELS } from '../modules/intervention-map/lib/permissions';
import { MapPage } from '../modules/intervention-map/MapPage';

// Only loaded when there are logins, so local mode never starts a Supabase client.
const AuthGate = lazy(() => import('./auth/AuthGate').then((module) => ({ default: module.AuthGate })));

function UserMenu({ user, changePassword, signOut }: { user: AppUser; changePassword(): void; signOut(): void }) {
  return (
    <div className="user-menu">
      <span>
        {user.full_name ?? 'Signed in'} · {ROLE_LABELS[user.role]}
      </span>
      <button type="button" className="header-button" onClick={changePassword}>
        Change password
      </button>
      <button type="button" className="header-button" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

function Frame({ menu, dataSources, children }: { menu?: ReactNode; dataSources: string[]; children: ReactNode }) {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span className="app-agency">Department of Agriculture – Provincial Agriculture Office, Marinduque</span>
          <h1>Intervention Map</h1>
        </div>
        {menu}
      </header>

      {children}

      <footer className="app-footer">
        {dataSources.length > 0 && <span>Data: {dataSources.join(', ')}</span>}
        <span>
          Boundaries: NAMRIA, PSA via{' '}
          <a href="https://data.humdata.org/dataset/cod-ab-phl" target="_blank" rel="noopener noreferrer">
            HDX
          </a>{' '}
          (CC BY-IGO)
        </span>
        {dataMode === 'local' && <span>Local mode: data stays in this browser</span>}
      </footer>
    </div>
  );
}

export function App() {
  const [dataSources, setDataSources] = useState<string[]>([]);
  const local = useMemo(() => (dataMode === 'local' ? localUser() : null), []);

  if (dataMode === 'unconfigured') {
    return (
      <Frame dataSources={[]}>
        <div className="page-message" role="alert">
          <h2>This copy of the map isn't set up</h2>
          <p>It was built without its Supabase settings. See docs/OPERATIONS.md.</p>
        </div>
      </Frame>
    );
  }

  if (local) {
    return (
      <Frame dataSources={dataSources}>
        <MapPage user={local} onDataSources={setDataSources} />
      </Frame>
    );
  }

  return (
    <Suspense fallback={<Frame dataSources={[]}><p className="page-message">Loading…</p></Frame>}>
      <AuthGate>
        {({ user, changePassword, signOut }) => (
          <Frame dataSources={dataSources} menu={<UserMenu user={user} changePassword={changePassword} signOut={signOut} />}>
            {/* A new person gets a new store and fresh data. */}
            <MapPage key={user.id} user={user} onDataSources={setDataSources} />
          </Frame>
        )}
      </AuthGate>
    </Suspense>
  );
}
