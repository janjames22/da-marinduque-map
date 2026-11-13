// /qa, /qa/condition and /import: working through flagged records, checking the condition of delivered
// units, and bringing in files. For Encoders and Admins. Each is its own page in the sidebar. Loaded only
// when opened, so the map doesn't carry it, and the database refuses anyone else whatever the screens do.
import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import type { AppUser, MapData } from '../data/types';
import { StoreContext } from '../state/store-context';
import { useMapData } from '../state/use-map-data';
import { ConditionCheck } from './ConditionCheck';
import { QaQueue } from './QaQueue';
import '../overview/overview.css';
import '../records/records.css';
import './work.css';
import { PageError, PageLoading, PageNoAccess } from '../overview/PageState';

// The file readers are only needed once a file is chosen.
const ImportPage = lazy(() => import('./ImportPage').then((module) => ({ default: module.ImportPage })));

function Workspace({ data, user }: { data: MapData; user: AppUser }) {
  return (
    <Routes>
      <Route path="/qa" element={<QaQueue data={data} user={user} />} />
      <Route path="/qa/condition" element={<ConditionCheck data={data} />} />
      <Route
        path="/import"
        element={
          <Suspense fallback={<PageLoading />}>
            <ImportPage data={data} user={user} />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/qa" replace />} />
    </Routes>
  );
}

function WorkLoader({ user }: { user: AppUser }) {
  const state = useMapData(user);
  if (state.status === 'loading') return <PageLoading />;
  if (state.status === 'error') return <PageError error={state.error} onRetry={state.retry} />;
  return (
    <StoreContext.Provider value={{ store: state.store, places: state.places }}>
      <Workspace data={state.data} user={user} />
    </StoreContext.Provider>
  );
}

export function WorkPage({ user }: { user: AppUser }) {
  if (user.role === 'viewer') {
    return (
      <PageNoAccess title="This page is for Encoders and Admins">
        Your account can view records but not change them. <Link to="/">Back to Home</Link>
      </PageNoAccess>
    );
  }
  return <WorkLoader user={user} />;
}
