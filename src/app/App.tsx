import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { dataMode, isDemo } from '../modules/intervention-map/data/app-config';
import { localUser } from '../modules/intervention-map/data/create-store';
import type { AppUser } from '../modules/intervention-map/data/types';
import { permissionsFor } from '../modules/intervention-map/lib/permissions';
import { afterMapData, closeMapDataSession, startMapData } from '../modules/intervention-map/state/use-map-data';
// The map stays in the first load. Phase 17b tried loading it apart, which halved the first load but
// made the map, the page most people open, slower to appear after signing in.
import { MapPage } from '../modules/intervention-map/MapPage';
import { HomePage } from '../modules/intervention-map/overview/HomePage';
import { isUpdateError } from '../modules/intervention-map/lib/error-message';
import { PageError, PageLoading } from '../modules/intervention-map/overview/PageState';
import { AuthLayout } from './auth/AuthLayout';
import { ErrorBoundary } from './ErrorBoundary';
import { movedAddress, pageFor } from './routes';
import { AppShell, type Account } from './shell/AppShell';

// Only loaded when there are logins, so local mode never starts a Supabase client.
// Not in the demo site's build, which has no logins and no Supabase.
const AuthGate = import.meta.env.MODE === 'demo' ? null : lazy(() => import('./auth/AuthGate').then((module) => ({ default: module.AuthGate })));
// Only in the demo site's build: Vite fills in the mode, so any other build leaves this out entirely.
const DemoGate = import.meta.env.MODE === 'demo' ? lazy(() => import('./auth/DemoSignIn').then((module) => ({ default: module.DemoGate }))) : null;
// Only loaded when opened, so the map doesn't carry the admin screens.
const loadAdmin = () => import('../modules/intervention-map/admin/AdminPage');
const AdminPage = lazy(() => loadAdmin().then((module) => ({ default: module.AdminPage })));

const loadWork = () => import('../modules/intervention-map/work/WorkPage');
const WorkPage = lazy(() => loadWork().then((module) => ({ default: module.WorkPage })));
// The charts load with the Dashboard, so Home and the map don't carry them.
const loadDashboard = () => import('../modules/intervention-map/overview/DashboardPage');
const DashboardPage = lazy(() => loadDashboard().then((module) => ({ default: module.DashboardPage })));
const loadReports = () => import('../modules/intervention-map/reports/ReportsPage');
const ReportsPage = lazy(() => loadReports().then((module) => ({ default: module.ReportsPage })));
const loadRecords = () => import('../modules/intervention-map/records/RecordsPage');
const RecordsPage = lazy(() => loadRecords().then((module) => ({ default: module.RecordsPage })));

// Once the first page has its data and the browser is idle, fetch the code for the other pages this
// person can open, so moving to one doesn't wait for it. Not sooner: the browser looks idle while it
// waits for the first page's code and data, and fetching the rest then slowed the map's first draw.
function prefetchPages(user: AppUser): () => void {
  let cancelIdle = () => {};
  const cancelWait = afterMapData(user, () => {
    cancelIdle = whenIdle(user);
  });
  return () => {
    cancelWait();
    cancelIdle();
  };
}

function whenIdle(user: AppUser): () => void {
  const { canEdit } = permissionsFor(user.role);
  const loads = [loadDashboard, loadRecords, loadReports, ...(canEdit ? [loadWork] : []), ...(user.role === 'admin' ? [loadAdmin] : [])];
  const run = () => loads.forEach((load) => void load().catch(() => {}));
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 4000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1500);
  return () => clearTimeout(id);
}

function Screen({ user, onDataSources }: { user: AppUser; onDataSources(sources: string[]): void }) {
  const location = useLocation();
  // An address from before the map moved to /map, or one that doesn't exist.
  const moved = movedAddress(location.pathname);
  if (moved) return <Navigate to={{ pathname: moved, search: location.search, hash: location.hash }} replace />;

  const page = pageFor(location.pathname);
  if (page === 'map') return <MapPage key={user.id} user={user} onDataSources={onDataSources} />;
  if (page === 'home') return <HomePage key={user.id} user={user} onDataSources={onDataSources} />;
  return (
    <Suspense fallback={<PageLoading />}>
      {page === 'dashboard' ? <DashboardPage key={user.id} user={user} onDataSources={onDataSources} /> : page === 'records' ? <RecordsPage key={user.id} user={user} onDataSources={onDataSources} /> : page === 'admin' ? <AdminPage key={user.id} user={user} /> : page === 'reports' ? <ReportsPage key={user.id} user={user} /> : <WorkPage key={user.id} user={user} />}
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
      {isDemo && <span>Demo: made-up data. Changes stay in this browser.</span>}
    </>
  );
}

// An error drawing a page shows in place of the page, with the menu still there to go elsewhere.
// Moving to another page clears it.
function PageCrashed({ error, reset }: { error: unknown; reset(): void }) {
  return (
    // A page's code that didn't come stays failed until a reload, even once back online.
    <PageError title="Something went wrong on this page" error={error} onRetry={isUpdateError(error) ? undefined : reset}>
      <p>
        <Link to="/">Back to Home</Link>
      </p>
    </PageError>
  );
}

function GuardedScreen(props: { user: AppUser; onDataSources(sources: string[]): void }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} fallback={(error, reset) => <PageCrashed error={error} reset={reset} />}>
      <Screen {...props} />
    </ErrorBoundary>
  );
}

function SignedIn({ user, account }: { user: AppUser; account?: Account }) {
  const [dataSources, setDataSources] = useState<string[]>([]);
  // The data starts loading while a page's code is still on its way, rather than after it.
  useEffect(() => startMapData(user), [user]);
  useEffect(() => prefetchPages(user), [user]);
  // Signing out, or someone else signing in, drops the shared data and its live updates.
  useEffect(() => () => closeMapDataSession(user), [user]);
  return (
    <AppShell user={user} account={account} footer={<Sources dataSources={dataSources} />}>
      {/* A new person gets a new store and fresh data. */}
      <GuardedScreen user={user} onDataSources={setDataSources} />
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

  if (DemoGate) {
    return (
      <Suspense fallback={<PageLoading />}>
        <DemoGate>{({ user, signOut }) => <SignedIn key={user.id} user={user} account={{ signOut }} />}</DemoGate>
      </Suspense>
    );
  }

  if (!AuthGate) return null;
  return (
    <Suspense fallback={<PageLoading />}>
      <AuthGate>{({ user, changePassword, signOut }) => <SignedIn user={user} account={{ changePassword, signOut }} />}</AuthGate>
    </Suspense>
  );
}
