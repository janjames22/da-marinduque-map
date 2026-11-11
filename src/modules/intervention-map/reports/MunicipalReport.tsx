// A municipality's profile on screen, and as a one-page PDF: its map, its figures, tables by program,
// status and category, and the barangays with no intervention yet.
import { Download, Landmark } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MapData } from '../data/types';
import { manilaToday } from '../lib/dates';
import { EmptyState } from '../overview/EmptyState';
import type { Boundaries } from '../state/use-map-data';
import { municipalMap } from './map-layers';
import { municipalProfile, type TallyRow } from './report-data';
import { ReportMap } from './ReportMap';
import { namePart, useReportDownload } from './use-report-download';

function Tally({ title, rows }: { title: string; rows: TallyRow[] }) {
  return (
    <div className="overview-card report-tally">
      <h3>By {title.toLowerCase()}</h3>
      <div className="table-scroll">
        <table className="data-table report-table" aria-label={`By ${title.toLowerCase()}`}>
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col" className="number">
                Records
              </th>
              <th scope="col" className="number">
                Units
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="number">{row.records}</td>
                <td className="number">{row.units}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3}>None</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MunicipalReport({ data, boundaries }: { data: MapData; boundaries: Boundaries }) {
  const { id } = useParams();
  const fieldId = useId();
  const navigate = useNavigate();
  const municipalityId = id ? Number(id) : null;
  const profile = useMemo(() => (municipalityId === null ? null : municipalProfile(data, municipalityId)), [data, municipalityId]);
  const map = useMemo(() => (profile ? municipalMap(profile, data, boundaries) : null), [profile, data, boundaries]);
  const { busy, failure, run } = useReportDownload();
  const numbers = profile?.numbers;
  const share = numbers?.operational;

  return (
    <section className="report-section" aria-label="Municipal profile">
      <div className="overview-card report-controls">
        <header className="overview-card-header">
          <div>
            <h2>Municipal profile</h2>
            <p>One municipality on one A4 page: its map, figures, tables and the barangays with no intervention yet.</p>
          </div>
          {profile && (
            <button
              type="button"
              className="ui-button ui-button-primary"
              disabled={busy !== null}
              onClick={() =>
                void run('pdf', async () => {
                  const { municipalPdf } = await import('./municipal-pdf');
                  const made = municipalPdf({ data, boundaries, municipalityId: profile.municipality.id, signatories: data.signatories, now: new Date() });
                  return made && { bytes: made.bytes, fileName: `Profile_${namePart(profile.municipality.name)}_${manilaToday()}.pdf`, format: 'pdf', records: made.records, filters: { report: 'municipal profile', municipality: profile.municipality.name } };
                })
              }
            >
              <Download aria-hidden="true" />
              {busy ? 'Making the PDF…' : 'Download PDF'}
            </button>
          )}
        </header>
        <div className="filter-field report-picker">
          <label htmlFor={`${fieldId}-municipality`}>Municipality</label>
          <select id={`${fieldId}-municipality`} value={municipalityId ?? ''} onChange={(event) => navigate(event.target.value ? `/reports/municipality/${event.target.value}` : '/reports/municipality')}>
            <option value="">Choose a municipality</option>
            {data.municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </div>
        {municipalityId !== null && !profile && <p className="field-error">There is no such municipality.</p>}
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
      </div>

      {municipalityId === null && (
        <div className="overview-card">
          <EmptyState icon={Landmark} title="Choose a municipality">
            Its profile shows here as it will print.
          </EmptyState>
        </div>
      )}

      {profile && numbers && share && map && (
        <>
          <div className="report-overview">
            <figure className="overview-card report-map-card">
              <ReportMap label={`Map of ${profile.municipality.name} with its interventions`} focus={map.focus} layers={map.layers} points={map.points} />
              <ul className="report-legend" aria-label="Map legend">
                {map.legend.map((entry) => (
                  <li key={entry.label}>
                    <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
                    {entry.label}
                  </li>
                ))}
              </ul>
            </figure>
            <dl className="report-figures" aria-label="Figures">
              <div className="report-figure is-hero">
                <dt>Interventions</dt>
                <dd>{numbers.records}</dd>
              </div>
              {numbers.types
                .filter((tile) => tile.units > 0)
                .map((tile) => (
                  <div key={tile.typeId} className="report-figure">
                    <dt>{tile.label}</dt>
                    <dd>{tile.units}</dd>
                  </div>
                ))}
              <div className="report-figure">
                <dt>Beneficiaries (approx.)</dt>
                <dd>{numbers.beneficiaries}</dd>
              </div>
              <div className="report-figure">
                <dt>Operational</dt>
                <dd>{share.percent === null ? '—' : `${share.percent}%`}</dd>
                <dd className="report-figure-note">{share.assessed === 0 ? 'None assessed yet' : `${share.units} of ${share.assessed} assessed`}</dd>
              </div>
              <div className="report-figure">
                <dt>Barangays with no intervention yet</dt>
                <dd>
                  {numbers.barangaysWithout} of {numbers.barangaysTotal}
                </dd>
              </div>
            </dl>
          </div>

          <div className="report-tallies">
            <Tally title="Program" rows={profile.byProgram} />
            <Tally title="Status" rows={profile.byStatus} />
            <Tally title="Category" rows={profile.byCategory} />
          </div>

          <section className="overview-card report-gaps" aria-label="Barangays with no intervention yet">
            <h3>
              Barangays with no intervention yet <span className="count">{profile.gaps.length}</span>
            </h3>
            {profile.gaps.length > 0 ? (
              <ul className="gap-list">
                {profile.gaps.map((barangay) => (
                  <li key={barangay.id}>{barangay.name}</li>
                ))}
              </ul>
            ) : (
              <p>Every barangay has at least one intervention.</p>
            )}
            <p className="report-note">What has been encoded, not what exists on the ground. On the map, shade barangays by "No intervention yet" to see them.</p>
          </section>
        </>
      )}
    </section>
  );
}
