// Every intervention one beneficiary has received, with where each is and its status history. Names are
// matched as the dashboard's "Beneficiaries (approx.)" matches them, until there's a proper list.
import { ArrowLeft, ChevronRight, Download, MapPin, SearchX } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MapData } from '../data/types';
import { manilaToday } from '../lib/dates';
import { recordOnMap } from '../lib/map-paths';
import { foldText } from '../lib/text';
import { EmptyState } from '../overview/EmptyState';
import type { Boundaries } from '../state/use-map-data';
import { beneficiaryMap } from './map-layers';
import { beneficiaryGroups, beneficiaryRecords, type BeneficiaryGroup } from './report-data';
import { ReportMap } from './ReportMap';
import { useReportDownload } from './use-report-download';

const LISTED = 60;

function Intro() {
  return (
    <header className="overview-card-header">
      <div>
        <h2>Beneficiary profile</h2>
        <p>All the interventions one beneficiary has received. Names are matched ignoring case, spacing and punctuation, so check that each belongs, until there's a proper list of beneficiaries.</p>
      </div>
    </header>
  );
}

function BeneficiaryList({ groups }: { groups: BeneficiaryGroup[] }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const wanted = foldText(search);
  const found = wanted ? groups.filter((group) => foldText([...group.spellings, ...group.municipalities].join(' ')).includes(wanted)) : groups;
  return (
    <>
      <div className="overview-card report-controls">
        <Intro />
        <div className="filter-field report-picker">
          <label htmlFor={`${id}-search`}>Find a beneficiary</label>
          <input id={`${id}-search`} type="search" placeholder="Name or municipality" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      <section className="overview-card beneficiary-card" aria-label="Beneficiaries">
        <p className="report-count" role="status">
          {found.length === 0 ? 'No beneficiary matches.' : `${found.length} ${found.length === 1 ? 'beneficiary' : 'beneficiaries'}${found.length > LISTED ? `, the first ${LISTED} shown` : ''}.`}
        </p>
        {found.length === 0 ? (
          <EmptyState icon={SearchX} title="Nobody by that name">
            Try part of the name, or the municipality.
          </EmptyState>
        ) : (
          <ul className="beneficiary-list">
            {found.slice(0, LISTED).map((group) => (
              <li key={group.key}>
                <Link to={`/reports/beneficiary/${encodeURIComponent(group.key)}`} className="beneficiary-row">
                  <span className="beneficiary-row-text">
                    <strong>{group.name}</strong>
                    <span>
                      {group.records.length} {group.records.length === 1 ? 'intervention' : 'interventions'} · {group.municipalities.join(', ')}
                    </span>
                  </span>
                  <ChevronRight className="report-card-arrow" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function BeneficiaryDetail({ group, data, boundaries }: { group: BeneficiaryGroup; data: MapData; boundaries: Boundaries }) {
  const rows = useMemo(() => beneficiaryRecords(group, data), [group, data]);
  const map = useMemo(() => beneficiaryMap(rows, group.municipalities, data, boundaries), [rows, group, data, boundaries]);
  const { busy, failure, run } = useReportDownload();
  return (
    <>
      <Link to="/reports/beneficiary" className="back-link">
        <ArrowLeft aria-hidden="true" />
        All beneficiaries
      </Link>
      <div className="overview-card report-controls">
        <header className="overview-card-header">
          <div className="report-heading">
            <strong>{group.name}</strong>
            <span>
              {group.records.length} {group.records.length === 1 ? 'intervention' : 'interventions'}, {group.units} {group.units === 1 ? 'unit' : 'units'}, in {group.municipalities.join(', ')}
            </span>
            {group.spellings.length > 1 && <span className="report-note">Also written as: {group.spellings.slice(1).join('; ')}</span>}
          </div>
          <button
            type="button"
            className="ui-button ui-button-primary"
            disabled={busy !== null}
            onClick={() =>
              void run('pdf', async () => {
                const [{ beneficiaryPdf }, { loadSeal }] = await Promise.all([import('./beneficiary-pdf'), import('./pdf-common')]);
                const seal = await loadSeal();
                const made = beneficiaryPdf({ data, boundaries, beneficiaryKey: group.key, signatories: data.signatories, now: new Date(), seal });
                // The name stays out of the file name, as it can be a person's.
                return made && { bytes: made.bytes, fileName: `Beneficiary_profile_${manilaToday()}.pdf`, format: 'pdf', records: made.records, filters: { report: 'beneficiary profile', beneficiary: group.name } };
              })
            }
          >
            <Download aria-hidden="true" />
            {busy ? 'Making the PDF…' : 'Download PDF'}
          </button>
        </header>
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
      </div>
      <div className="report-overview">
        <figure className="overview-card report-map-card">
          <ReportMap label={`Where ${group.name}'s interventions are`} focus={map.focus} layers={map.layers} points={map.points} />
          <ul className="report-legend" aria-label="Map legend">
            {map.legend.map((entry) => (
              <li key={entry.label}>
                <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
                {entry.label}
              </li>
            ))}
          </ul>
        </figure>
        <ol className="beneficiary-records">
          {rows.map((row) => (
            <li key={row.record.id} className="overview-card beneficiary-record" data-record={row.record.id}>
              <h3>{row.name}</h3>
              <p>{[row.type, row.program, row.year && `funded ${row.year}`, `${row.record.quantity} ${row.record.quantity === 1 ? 'unit' : 'units'}`].filter(Boolean).join(' · ')}</p>
              <p className="beneficiary-place">
                <MapPin aria-hidden="true" />
                <span>
                  {row.place || 'No place yet'}
                  {row.point ? ` · ${row.point.lat.toFixed(6)}, ${row.point.lng.toFixed(6)}` : ' · No coordinates yet'} · <Link to={recordOnMap(row.record.id)}>Show on the map</Link>
                </span>
              </p>
              <ol className="status-timeline timeline" aria-label={`Status history of ${row.name}`}>
                {row.history.map((entry) => (
                  <li key={entry.entry.id}>
                    <span className="timeline-dot" style={{ background: data.statuses.find((status) => status.id === entry.entry.status_id)?.color }} aria-hidden="true" />
                    <span>
                      <strong>{entry.status}</strong>
                      <span className="muted"> {entry.when}</span>
                      {entry.remarks && <span className="status-remarks muted">{entry.remarks}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

export function BeneficiaryReport({ data, boundaries }: { data: MapData; boundaries: Boundaries }) {
  const { key } = useParams();
  const groups = useMemo(() => beneficiaryGroups(data), [data]);
  const group = key ? groups.find((candidate) => candidate.key === key) : undefined;
  return (
    <section className="report-section" aria-label="Beneficiary profile">
      {key && !group && (
        <div className="overview-card report-controls">
          <Intro />
          <p className="field-error" role="alert">
            No beneficiary on the map has that name any more. <Link to="/reports/beneficiary">See them all</Link>
          </p>
        </div>
      )}
      {group ? <BeneficiaryDetail group={group} data={data} boundaries={boundaries} /> : !key && <BeneficiaryList groups={groups} />}
    </section>
  );
}
