// /reports: the municipal profile, beneficiary profile and inventory report, each as a PDF, the inventory
// as Excel too. For everyone signed in, as they only read. Loaded only when opened, so the map doesn't
// carry it, and the PDF code loads only when a file is made.
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { AppUser, MapData } from '../data/types';
import { StoreContext } from '../state/store-context';
import { useMapData, type Boundaries } from '../state/use-map-data';
import { BeneficiaryReport } from './BeneficiaryReport';
import { InventoryReport } from './InventoryReport';
import { MunicipalReport } from './MunicipalReport';
import { activeSignatories } from './report-data';

const SECTIONS = [
  { path: '/reports', label: 'Overview', end: true },
  { path: '/reports/municipality', label: 'Municipal profile', end: false },
  { path: '/reports/beneficiary', label: 'Beneficiary profile', end: false },
  { path: '/reports/inventory', label: 'Inventory report', end: true },
];

function Overview({ data, user }: { data: MapData; user: AppUser }) {
  const signing = activeSignatories(data.signatories);
  return (
    <section className="admin-section report-section" aria-label="Reports">
      <header className="admin-section-header">
        <div>
          <h2>Reports</h2>
          <p className="field-hint">Each report covers every record on the map, whatever the map's filters, and downloads as a PDF ready to print and sign. Downloads go in the audit log, as exports do.</p>
        </div>
      </header>
      <ul className="report-list">
        <li>
          <Link to="/reports/municipality">Municipal profile</Link>
          <span className="field-hint">One municipality on one page: its map with the interventions, the figures, tables by program, status and category, and the barangays with no intervention yet.</span>
        </li>
        <li>
          <Link to="/reports/beneficiary">Beneficiary profile</Link>
          <span className="field-hint">All the interventions one FCA or other beneficiary has received, with where each is and its status history.</span>
        </li>
        <li>
          <Link to="/reports/inventory">Inventory report</Link>
          <span className="field-hint">In the layout of the RAED Consolidated Inventory Report, for any municipality, program and year, as a PDF or an Excel workbook.</span>
        </li>
        <li>
          <strong>Print map</strong>
          <span className="field-hint">The map as it is on screen, with a title, legend, north arrow, scale bar, date and data sources. Set up the map, then choose Print map beside Export.</span>
        </li>
      </ul>
      <h3 className="section-title">Signature blocks</h3>
      <p className="field-hint">At the foot of every report and printed map, in this order.</p>
      {signing.length === 0 ? (
        <p className="empty-note">None. Reports print without them.</p>
      ) : (
        <ul className="signature-list">
          {signing.map((signatory) => (
            <li key={signatory.id}>
              <span className="field-hint">{signatory.label}:</span> <strong>{signatory.name}</strong>
              {signatory.position && <span className="field-hint">, {signatory.position}</span>}
            </li>
          ))}
        </ul>
      )}
      {user.role === 'admin' ? <Link to="/admin/signatures">Change them in Admin, Report signatures</Link> : <p className="field-hint">An Admin can change them.</p>}
    </section>
  );
}

function Reports({ data, boundaries, user }: { data: MapData; boundaries: Boundaries; user: AppUser }) {
  return (
    <main className="admin-page work-page reports-page">
      <nav className="admin-nav" aria-label="Reports">
        {SECTIONS.map((section) => (
          <NavLink key={section.path} to={section.path} end={section.end} className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <div className="admin-content">
        <Routes>
          <Route path="/reports" element={<Overview data={data} user={user} />} />
          <Route path="/reports/municipality" element={<MunicipalReport data={data} boundaries={boundaries} />} />
          <Route path="/reports/municipality/:id" element={<MunicipalReport data={data} boundaries={boundaries} />} />
          <Route path="/reports/beneficiary" element={<BeneficiaryReport data={data} boundaries={boundaries} />} />
          <Route path="/reports/beneficiary/:key" element={<BeneficiaryReport data={data} boundaries={boundaries} />} />
          <Route path="/reports/inventory" element={<InventoryReport data={data} />} />
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </div>
    </main>
  );
}

export function ReportsPage({ user }: { user: AppUser }) {
  const state = useMapData(user);
  if (state.status === 'loading') return <p className="page-message is-loading">Loading…</p>;
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
      <Reports data={state.data} boundaries={state.boundaries} user={user} />
    </StoreContext.Provider>
  );
}
