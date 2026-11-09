// Every intervention one beneficiary has received, with where each is and its status history. Names are
// matched as the dashboard's "Beneficiaries (approx.)" matches them, until there's a proper list.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MapData } from '../data/types';
import { manilaToday } from '../lib/dates';
import { foldText } from '../lib/text';
import type { Boundaries } from '../state/use-map-data';
import { beneficiaryMap } from './map-layers';
import { beneficiaryGroups, beneficiaryRecords, type BeneficiaryGroup } from './report-data';
import { ReportMap } from './ReportMap';
import { useReportDownload } from './use-report-download';

const LISTED = 60;

function BeneficiaryList({ groups }: { groups: BeneficiaryGroup[] }) {
  const [search, setSearch] = useState('');
  const wanted = foldText(search);
  const found = wanted ? groups.filter((group) => foldText([...group.spellings, ...group.municipalities].join(' ')).includes(wanted)) : groups;
  return (
    <>
      <label className="field report-picker">
        <span>Find a beneficiary</span>
        <input type="search" placeholder="Name or municipality" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <p className="records-count" role="status">
        {found.length === 0 ? 'No beneficiary matches.' : `${found.length} ${found.length === 1 ? 'beneficiary' : 'beneficiaries'}${found.length > LISTED ? `, the first ${LISTED} shown` : ''}.`}
      </p>
      <ul className="queue-list beneficiary-list">
        {found.slice(0, LISTED).map((group) => (
          <li key={group.key} className="queue-item">
            <div className="queue-item-main">
              <Link to={`/reports/beneficiary/${encodeURIComponent(group.key)}`}>{group.name}</Link>
              <span className="field-hint">
                {group.records.length} {group.records.length === 1 ? 'intervention' : 'interventions'} · {group.municipalities.join(', ')}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function BeneficiaryDetail({ group, data, boundaries }: { group: BeneficiaryGroup; data: MapData; boundaries: Boundaries }) {
  const rows = useMemo(() => beneficiaryRecords(group, data), [group, data]);
  const map = useMemo(() => beneficiaryMap(rows, group.municipalities, data, boundaries), [rows, group, data, boundaries]);
  const { busy, failure, run } = useReportDownload();
  return (
    <>
      <p>
        <Link to="/reports/beneficiary">All beneficiaries</Link>
      </p>
      <div className="report-heading">
        <strong>{group.name}</strong>
        <span>
          {group.records.length} {group.records.length === 1 ? 'intervention' : 'interventions'}, {group.units} {group.units === 1 ? 'unit' : 'units'}, in {group.municipalities.join(', ')}
        </span>
        {group.spellings.length > 1 && <span className="field-hint">Also written as: {group.spellings.slice(1).join('; ')}</span>}
      </div>
      <div className="form-actions report-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy !== null}
          onClick={() =>
            void run('pdf', async () => {
              const { beneficiaryPdf } = await import('./beneficiary-pdf');
              const made = beneficiaryPdf({ data, boundaries, beneficiaryKey: group.key, signatories: data.signatories, now: new Date() });
              // The name stays out of the file name, as it can be a person's.
              return made && { bytes: made.bytes, fileName: `Beneficiary_profile_${manilaToday()}.pdf`, format: 'pdf', records: made.records, filters: { report: 'beneficiary profile', beneficiary: group.name } };
            })
          }
        >
          {busy ? 'Making the PDF…' : 'Download PDF'}
        </button>
      </div>
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}
      <ReportMap label={`Where ${group.name}'s interventions are`} focus={map.focus} layers={map.layers} points={map.points} />
      <ul className="report-legend" aria-label="Map legend">
        {map.legend.map((entry) => (
          <li key={entry.label}>
            <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
            {entry.label}
          </li>
        ))}
      </ul>
      <ol className="beneficiary-records">
        {rows.map((row) => (
          <li key={row.record.id} className="report-block" data-record={row.record.id}>
            <h3>{row.name}</h3>
            <p>
              {[row.type, row.program, row.year && `funded ${row.year}`, `${row.record.quantity} ${row.record.quantity === 1 ? 'unit' : 'units'}`].filter(Boolean).join(' · ')}
            </p>
            <p>
              {row.place || 'No place yet'}
              {row.point ? ` · ${row.point.lat.toFixed(6)}, ${row.point.lng.toFixed(6)}` : ' · No coordinates yet'} · <Link to={`/records/${row.record.id}`}>Show on the map</Link>
            </p>
            <ol className="status-timeline" aria-label={`Status history of ${row.name}`}>
              {row.history.map((entry) => (
                <li key={entry.entry.id}>
                  <strong>{entry.status}</strong> {entry.when}
                  {entry.remarks && <div className="status-remarks">{entry.remarks}</div>}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </>
  );
}

export function BeneficiaryReport({ data, boundaries }: { data: MapData; boundaries: Boundaries }) {
  const { key } = useParams();
  const groups = useMemo(() => beneficiaryGroups(data), [data]);
  const group = key ? groups.find((candidate) => candidate.key === key) : undefined;
  return (
    <section className="admin-section report-section" aria-label="Beneficiary profile">
      <header className="admin-section-header">
        <div>
          <h2>Beneficiary profile</h2>
          <p className="field-hint">All the interventions one beneficiary has received. Names are matched ignoring case, spacing and punctuation, so check that each belongs, until there's a proper list of beneficiaries.</p>
        </div>
      </header>
      {key && !group && (
        <p className="field-error" role="alert">
          No beneficiary on the map has that name any more. <Link to="/reports/beneficiary">See them all</Link>
        </p>
      )}
      {group ? <BeneficiaryDetail group={group} data={data} boundaries={boundaries} /> : !key && <BeneficiaryList groups={groups} />}
    </section>
  );
}
