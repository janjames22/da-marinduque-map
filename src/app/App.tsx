import { lazy, Suspense, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { dataMode } from '../modules/intervention-map/data/app-config';
import { localUser } from '../modules/intervention-map/data/create-store';
import type { AppUser } from '../modules/intervention-map/data/types';
import { MapPage } from '../modules/intervention-map/MapPage';
import { AuthLayout } from './auth/AuthLayout';
import { movedAddress, pageFor } from './routes';
import { AppShell, type Account } from './shell/AppShell';

// Only loaded when there are logins, so local mode never starts a Supabase client.
const AuthGate = lazy(() => import('./auth/AuthGate').then((module) => ({ default: module.AuthGate })));
// Only loaded when opened, so the map doesn't carry the admin screens.
const AdminPage = lazy(() => import('../modules/intervention-map/admin/AdminPage').then((module) => ({ default: module.AdminPage })));

const WorkPage = lazy(() => import('../modules/intervention-map/work/WorkPage').then((module) => ({ default: module.WorkPage })));
const ReportsPage = lazy(() => import('../modules/intervention-map/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })));

function Screen({ user, onDataSources }: { user: AppUser; onDataSources(sources: string[]): void }) {
  const location = useLocation();
  // An address from before the map moved to /map, or one that doesn't exist.
  const moved = movedAddress(location.pathname);
  if (moved) return <Navigate to={{ pathname: moved, search: location.search, hash: location.hash }} replace />;

  const page = pageFor(location.pathname);
  if (page === 'map') return <MapPage key={user.id} user={user} onDataSources={onDataSources} />;
  return (
    <Suspense fallback={<p className="page-message">Loading…</p>}>
      {page === 'admin' ? <AdminPage key={user.id} user={user} /> : page === 'reports' ? <ReportsPage key={user.id} user={user} /> : <WorkPage key={user.id} user={user} />}
    </Suspense>
  );
}

function Sources({ dataSources }: { dataSources: string[] }) {
  return (
    <>
      {dataSources.length > 0 && <span>Data: {dataSources.join(', ')}</span>}
      <span>
        Boundaries: NAMRIA, PSA via{' '}
        <a href="https://data.humdata.org/dataset/cod-ab-phl" target="_blank" rel="noopener noreferrer">
          HDX
        </a>{' '}
        (CC BY-IGO)
      </span>
      {dataMode === 'local' && <span>Local mode: data stays in this browser</span>}
    </>
  );
}

function SignedIn({ user, account }: { user: AppUser; account?: Account }) {
  const [dataSources, setDataSources] = useState<string[]>([]);
  return (
    <AppShell user={user} account={account} footer={<Sources dataSources={dataSources} />}>
      {/* A new person gets a new store and fresh data. */}
      <Screen user={user} onDataSources={setDataSources} />
    </AppShell>
  );
}

export function App() {
  const local = useMemo(() => (dataMode === 'local' ? localUser() : null), []);

  if (dataMode === 'unconfigured') {
    return (
      <AuthLayout>
        <div className="auth-card" role="alert">
          <h2>This copy of the map isn't set up</h2>
          <p>It was built without its Supabase settings. See docs/OPERATIONS.md.</p>
        </div>
      </AuthLayout>
    );
  }

  if (local) return <SignedIn user={local} />;

  return (
    <Suspense fallback={<p className="page-message">Loading…</p>}>
      <AuthGate>{({ user, changePassword, signOut }) => <SignedIn user={user} account={{ changePassword, signOut }} />}</AuthGate>
    </Suspense>
  );
}
