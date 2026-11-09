// A municipality's profile on screen, and as a one-page PDF: its map, its figures, tables by program,
// status and category, and the barangays with no intervention yet.
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MapData } from '../data/types';
import { manilaToday } from '../lib/dates';
import type { Boundaries } from '../state/use-map-data';
import { municipalMap } from './map-layers';
import { municipalProfile, type TallyRow } from './report-data';
import { ReportMap } from './ReportMap';
import { namePart, useReportDownload } from './use-report-download';

function Tally({ title, rows }: { title: string; rows: TallyRow[] }) {
  return (
    <table className="records-table report-table" aria-label={`By ${title.toLowerCase()}`}>
      <thead>
        <tr>
          <th scope="col">{title}</th>
          <th scope="col">Records</th>
          <th scope="col">Units</th>
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
  );
}

export function MunicipalReport({ data, boundaries }: { data: MapData; boundaries: Boundaries }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const municipalityId = id ? Number(id) : null;
  const profile = useMemo(() => (municipalityId === null ? null : municipalProfile(data, municipalityId)), [data, municipalityId]);
  const map = useMemo(() => (profile ? municipalMap(profile, data, boundaries) : null), [profile, data, boundaries]);
  const { busy, failure, run } = useReportDownload();
  const numbers = profile?.numbers;
  const share = numbers?.operational;

  return (
    <section className="admin-section report-section" aria-label="Municipal profile">
      <header className="admin-section-header">
        <div>
          <h2>Municipal profile</h2>
          <p className="field-hint">One municipality on one page: its map, figures, tables and the barangays with no intervention yet. Every record on the map, whatever the map's filters.</p>
        </div>
      </header>
      <label className="field report-picker">
        <span>Municipality</span>
        <select value={municipalityId ?? ''} onChange={(event) => navigate(event.target.value ? `/reports/municipality/${event.target.value}` : '/reports/municipality')}>
          <option value="">Choose a municipality</option>
          {data.municipalities.map((municipality) => (
            <option key={municipality.id} value={municipality.id}>
              {municipality.name}
            </option>
          ))}
        </select>
      </label>
      {municipalityId !== null && !profile && <p className="field-error">There is no such municipality.</p>}

      {profile && numbers && share && map && (
        <>
          <div className="form-actions report-actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy !== null}
              onClick={() =>
                void run('pdf', async () => {
                  const { municipalPdf } = await import('./municipal-pdf');
                  const made = municipalPdf({ data, boundaries, municipalityId: profile.municipality.id, signatories: data.signatories, now: new Date() });
                  return made && { bytes: made.bytes, fileName: `Profile_${namePart(profile.municipality.name)}_${manilaToday()}.pdf`, format: 'pdf', records: made.records, filters: { report: 'municipal profile', municipality: profile.municipality.name } };
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

          <div className="report-overview">
            <ReportMap label={`Map of ${profile.municipality.name} with its interventions`} focus={map.focus} layers={map.layers} points={map.points} />
            <dl className="report-figures" aria-label="Figures">
              <div>
                <dt>Interventions</dt>
                <dd>{numbers.records}</dd>
              </div>
              {numbers.types
                .filter((tile) => tile.units > 0)
                .map((tile) => (
                  <div key={tile.typeId}>
                    <dt>{tile.label}</dt>
                    <dd>{tile.units}</dd>
                  </div>
                ))}
              <div>
                <dt>Beneficiaries (approx.)</dt>
                <dd>{numbers.beneficiaries}</dd>
              </div>
              <div>
                <dt>Operational</dt>
                <dd>{share.percent === null ? '—' : `${share.percent}%`}</dd>
                <dd className="field-hint">{share.assessed === 0 ? 'None assessed yet' : `${share.units} of ${share.assessed} assessed`}</dd>
              </div>
              <div>
                <dt>Barangays with no intervention yet</dt>
                <dd>
                  {numbers.barangaysWithout} of {numbers.barangaysTotal}
                </dd>
              </div>
            </dl>
          </div>
          <ul className="report-legend" aria-label="Map legend">
            {map.legend.map((entry) => (
              <li key={entry.label}>
                <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
                {entry.label}
              </li>
            ))}
          </ul>

          <div className="report-tallies">
            <Tally title="Program" rows={profile.byProgram} />
            <Tally title="Status" rows={profile.byStatus} />
            <Tally title="Category" rows={profile.byCategory} />
          </div>

          <section className="report-block" aria-label="Barangays with no intervention yet">
            <h3>
              Barangays with no intervention yet <span className="count">{profile.gaps.length}</span>
            </h3>
            <p>{profile.gaps.length > 0 ? profile.gaps.map((barangay) => barangay.name).join(', ') : 'Every barangay has at least one intervention.'}</p>
            <p className="field-hint">What has been encoded, not what exists on the ground. On the map, shade barangays by "No intervention yet" to see them.</p>
          </section>
        </>
      )}
    </section>
  );
}
