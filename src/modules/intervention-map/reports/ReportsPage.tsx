// /reports: the municipal profile, beneficiary profile and inventory report, each as a PDF, the inventory
// as Excel too. For everyone signed in, as they only read. Loaded only when opened, so the map doesn't
// carry it, and the PDF code loads only when a file is made.
import { ChevronRight, Landmark, Printer, Table2, UsersRound, type LucideIcon } from 'lucide-react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { AppUser, MapData } from '../data/types';
import { MAP_PATH } from '../lib/map-paths';
import { StoreContext } from '../state/store-context';
import { useMapData, type Boundaries } from '../state/use-map-data';
import { BeneficiaryReport } from './BeneficiaryReport';
import { InventoryReport } from './InventoryReport';
import { MunicipalReport } from './MunicipalReport';
import { activeSignatories } from './report-data';
import '../overview/overview.css';
import '../records/records.css';
import './reports.css';
import { PageError, PageLoading } from '../overview/PageState';

const SECTIONS = [
  { path: '/reports', label: 'Overview', end: true },
  { path: '/reports/municipality', label: 'Municipal profile', end: false },
  { path: '/reports/beneficiary', label: 'Beneficiary profile', end: false },
  { path: '/reports/inventory', label: 'Inventory report', end: true },
];

const REPORTS: { to: string; title: string; icon: LucideIcon; text: string; format: string }[] = [
  {
    to: '/reports/municipality',
    title: 'Municipal profile',
    icon: Landmark,
    text: 'One municipality on one page: its map with the interventions, the figures, tables by program, status and category, and the barangays with no intervention yet.',
    format: 'PDF, A4',
  },
  {
    to: '/reports/beneficiary',
    title: 'Beneficiary profile',
    icon: UsersRound,
    text: 'All the interventions one FCA or other beneficiary has received, with where each is and its status history.',
    format: 'PDF, A4',
  },
  {
    to: '/reports/inventory',
    title: 'Inventory report',
    icon: Table2,
    text: 'In the layout of the RAED Consolidated Inventory Report, for any municipality, program and year.',
    format: 'PDF or Excel, legal',
  },
  {
    to: MAP_PATH,
    title: 'Print map',
    icon: Printer,
    text: 'The map as it is on screen, with a title, legend, north arrow, scale bar, date and sources. Set up the map, then choose Print map beside Export.',
    format: 'PDF, from the map',
  },
];

function Overview({ data, user }: { data: MapData; user: AppUser }) {
  const signing = activeSignatories(data.signatories);
  return (
    <div className="report-section">
      <ul className="report-cards">
        {REPORTS.map((report) => (
          <li key={report.title}>
            <Link to={report.to} className="overview-card report-card">
              <span className="overview-icon-tile" aria-hidden="true">
                <report.icon />
              </span>
              <span className="report-card-text">
                <strong>{report.title}</strong>
                <span>{report.text}</span>
                <span className="report-card-format">{report.format}</span>
              </span>
              <ChevronRight className="report-card-arrow" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      <section className="overview-card" aria-labelledby="signatures-title">
        <header className="overview-card-header">
          <div>
            <h2 id="signatures-title">Signature blocks</h2>
            <p>At the foot of every report and printed map, in this order.</p>
          </div>
          {user.role === 'admin' && (
            <Link to="/admin/signatures" className="ui-button ui-button-secondary">
              Change them in Signature blocks
            </Link>
          )}
        </header>
        {signing.length === 0 ? (
          <p className="empty-note">None. Reports print without them.</p>
        ) : (
          <ul className="signature-list">
            {signing.map((signatory) => (
              <li key={signatory.id}>
                <span className="signature-label">{signatory.label}:</span> <strong className="signature-name">{signatory.name}</strong>
                {signatory.position && (
                  <span className="signature-position">
                    <span className="visually-hidden">, </span>
                    {signatory.position}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {user.role !== 'admin' && <p className="report-note">An Admin can change them.</p>}
      </section>
    </div>
  );
}

function Reports({ data, boundaries, user }: { data: MapData; boundaries: Boundaries; user: AppUser }) {
  return (
    <main className="overview-page reports-page" aria-labelledby="reports-title">
      <header className="page-header">
        <h1 id="reports-title">Reports</h1>
        <p>Each covers every record, whatever the map's filters, and downloads ready to print and sign. Downloads go in the audit log, as exports do.</p>
      </header>
      <nav className="page-tabs" aria-label="Reports">
        {SECTIONS.map((section) => (
          <NavLink key={section.path} to={section.path} end={section.end} className="page-tab">
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route path="/reports" element={<Overview data={data} user={user} />} />
        <Route path="/reports/municipality" element={<MunicipalReport data={data} boundaries={boundaries} />} />
        <Route path="/reports/municipality/:id" element={<MunicipalReport data={data} boundaries={boundaries} />} />
        <Route path="/reports/beneficiary" element={<BeneficiaryReport data={data} boundaries={boundaries} />} />
        <Route path="/reports/beneficiary/:key" element={<BeneficiaryReport data={data} boundaries={boundaries} />} />
        <Route path="/reports/inventory" element={<InventoryReport data={data} />} />
        <Route path="*" element={<Navigate to="/reports" replace />} />
      </Routes>
    </main>
  );
}

export function ReportsPage({ user }: { user: AppUser }) {
  const state = useMapData(user);
  if (state.status === 'loading') return <PageLoading />;
  if (state.status === 'error') return <PageError error={state.error} onRetry={state.retry} />;
  return (
    <StoreContext.Provider value={{ store: state.store, places: state.places }}>
      <Reports data={state.data} boundaries={state.boundaries} user={user} />
    </StoreContext.Provider>
  );
}
