// /qa and /import: working through flagged records, checking the condition of delivered units, and
// bringing in files. For Encoders and Admins. Loaded only when opened, so the map doesn't carry it, and
// the database refuses anyone else whatever the screens do.
import { lazy, Suspense } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import type { AppUser, MapData } from '../data/types';
import { StoreContext } from '../state/store-context';
import { useMapData } from '../state/use-map-data';
import { ConditionCheck } from './ConditionCheck';
import { QaQueue } from './QaQueue';

// The file readers are only needed once a file is chosen.
const ImportPage = lazy(() => import('./ImportPage').then((module) => ({ default: module.ImportPage })));

const SECTIONS = [
  { path: '/qa', label: 'QA queue', end: true },
  { path: '/qa/condition', label: 'Condition check', end: true },
  { path: '/import', label: 'Import', end: true },
];

function Workspace({ data, user }: { data: MapData; user: AppUser }) {
  return (
    <main className="admin-page work-page">
      <nav className="admin-nav" aria-label="QA and import">
        {SECTIONS.map((section) => (
          <NavLink key={section.path} to={section.path} end={section.end} className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <div className="admin-content">
        <Routes>
          <Route path="/qa" element={<QaQueue data={data} user={user} />} />
          <Route path="/qa/condition" element={<ConditionCheck data={data} />} />
          <Route
            path="/import"
            element={
              <Suspense fallback={<p className="page-message">Loading…</p>}>
                <ImportPage data={data} user={user} />
              </Suspense>
            }
          />
        </Routes>
      </div>
    </main>
  );
}

function WorkLoader({ user }: { user: AppUser }) {
  const state = useMapData(user);
  if (state.status === 'loading') return <p className="page-message">Loading…</p>;
  if (state.status === 'error') {
    return (
      <div className="page-message" role="alert">
        <h2>This page could not load</h2>
        <p>{state.error.message}</p>
      </div>
    );
  }
  return (
    <StoreContext.Provider value={{ store: state.store, places: state.places }}>
      <Workspace data={state.data} user={user} />
    </StoreContext.Provider>
  );
}

export function WorkPage({ user }: { user: AppUser }) {
  if (user.role === 'viewer') {
    return (
      <div className="page-message" role="alert">
        <h2>This page is for Encoders and Admins</h2>
        <p>
          Your account can view records but not change them. <Link to="/">Back to the map</Link>
        </p>
      </div>
    );
  }
  return <WorkLoader user={user} />;
}
