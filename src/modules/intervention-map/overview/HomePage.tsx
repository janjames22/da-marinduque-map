// / : where everyone lands after signing in. The headline figures for the whole province, what's
// waiting for the person to do, and a card for each type. Every figure counts every record, including
// those not on the map yet, and comes from the same code as the dashboard.
import { ArrowRight, ChartColumn, Gauge, ListChecks, Map as MapIcon, MapPin, MapPinOff, Plus, Route, Users } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AppUser, MapData } from '../data/types';
import { liveRecords } from '../lib/choropleth';
import { buildDashboard, type BarRow } from '../lib/dashboard';
import { ADD_ON_MAP, AWAITING_LIST, MAP_PATH } from '../lib/map-paths';
import { awaitingCount, awaitingLocation, hasRoads, unitsByCategoryGroup } from '../lib/overview';
import { permissionsFor } from '../lib/permissions';
import { useMapData } from '../state/use-map-data';
import './overview.css';

const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, word: string, words = `${word}s`) => `${count(value)} ${value === 1 ? word : words}`;
const LEGEND_SIZE = 4;

export function Tile({ label, value, note, hero, icon, id }: { label: string; value: string; note?: ReactNode; hero?: boolean; icon?: ReactNode; id: string }) {
  return (
    <div className={`overview-tile${hero ? ' is-hero' : ''}`} data-tile={id}>
      {icon && <span className="overview-icon-tile">{icon}</span>}
      <dt>{label}</dt>
      <dd className="overview-tile-value">{value}</dd>
      {note && <dd className="overview-tile-note">{note}</dd>}
    </div>
  );
}

// A share of the whole as one bar, with each part named under it. Past the limit, the smallest parts are
// put together, in the bar as well as under it, so the two always match.
export function SegmentedBar({ rows, label, limit = LEGEND_SIZE }: { rows: BarRow[]; label: string; limit?: number }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return null;
  const shown = rows.length > limit + 1 ? rows.slice(0, limit) : rows;
  const rest = rows.slice(shown.length);
  const legend = rest.length > 0 ? [...shown, { key: 'rest', label: 'Other groups', value: rest.reduce((sum, row) => sum + row.value, 0), color: '#757575' }] : shown;
  const share = (value: number) => `${Math.round((value / total) * 100)}%`;
  return (
    <>
      <div className="segmented-bar" role="img" aria-label={`${label}: ${rows.map((row) => `${row.label} ${count(row.value)}`).join(', ')}`}>
        {legend.map((row) => (
          <span key={row.key} style={{ flexGrow: row.value, background: row.color }} />
        ))}
      </div>
      <ul className="segmented-legend" aria-hidden="true">
        {legend.map((row) => (
          <li key={row.key}>
            <span className="segmented-key">
              <span className="segmented-dot" style={{ background: row.color }} />
              {row.label}
            </span>
            <strong>
              {count(row.value)} <span>{share(row.value)}</span>
            </strong>
          </li>
        ))}
      </ul>
    </>
  );
}

function WorkRow({ to, icon, title, note, accent }: { to: string; icon: ReactNode; title: string; note: string; accent?: boolean }) {
  return (
    <li>
      <Link to={to} className="work-row">
        <span className={`overview-icon-tile${accent ? ' is-accent' : ''}`}>{icon}</span>
        <span className="work-row-text">
          <strong>{title}</strong>
          <span>{note}</span>
        </span>
        <ArrowRight aria-hidden="true" className="work-row-arrow" />
      </Link>
    </li>
  );
}

function Home({ data, user }: { data: MapData; user: AppUser }) {
  const { canEdit } = permissionsFor(user.role);
  const records = useMemo(() => liveRecords(data.interventions, data.types), [data.interventions, data.types]);
  const numbers = useMemo(() => buildDashboard(records, data, data.barangays), [records, data]);
  const waiting = useMemo(() => awaitingCount(awaitingLocation(records, data)), [records, data]);
  const notAssessed = numbers.operational.notAssessed.reduce((sum, status) => sum + status.units, 0);
  const firstName = user.full_name?.trim().split(/\s+/)[0];
  const { operational } = numbers;

  const activeTypes = data.types.filter((type) => type.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const typeCards = activeTypes.map((type) => {
    const ofType = records.filter((record) => record.intervention_type_id === type.id);
    const units = ofType.reduce((sum, record) => sum + record.quantity, 0);
    const statusUnits = new Map<number, number>();
    for (const record of ofType) if (record.status_id !== null) statusUnits.set(record.status_id, (statusUnits.get(record.status_id) ?? 0) + record.quantity);
    const statuses = data.statuses.filter((status) => statusUnits.has(status.id)).sort((a, b) => statusUnits.get(b.id)! - statusUnits.get(a.id)!);
    return { type, ofType, units, groups: unitsByCategoryGroup(ofType, data), statuses: statuses.map((status) => ({ status, units: statusUnits.get(status.id)! })) };
  });

  const work = canEdit
    ? [
        numbers.needingQa > 0 && <WorkRow key="qa" to="/qa" icon={<ListChecks aria-hidden="true" />} title={`${plural(numbers.needingQa, 'record needs', 'records need')} QA`} note="Names to check, possible duplicates and missing barangays. Worst first in the QA queue." />,
        waiting > 0 && <WorkRow key="coords" accent to={AWAITING_LIST} icon={<MapPinOff aria-hidden="true" />} title={`${plural(waiting, 'record is', 'records are')} waiting for verified coordinates`} note="Counted in every total, but not on the map until the region confirms where they are." />,
        notAssessed > 0 && <WorkRow key="condition" to="/qa/condition" icon={<Gauge aria-hidden="true" />} title={`${plural(notAssessed, 'unit has', 'units have')} no condition recorded yet`} note="Record whether each still works in Condition check." />,
      ].filter(Boolean)
    : [];

  return (
    <main className="overview-page" aria-labelledby="home-title">
      <section className="welcome-banner">
        <h1 id="home-title">{firstName ? `Welcome, ${firstName}` : 'Welcome'}</h1>
        <p>Figures come from every record in the system, including those not yet on the map.</p>
        <div className="welcome-actions">
          <Link to="/dashboard" className="on-dark-button">
            <ChartColumn aria-hidden="true" />
            Open dashboard
          </Link>
          <Link to={MAP_PATH} className="on-dark-button">
            <MapIcon aria-hidden="true" />
            View the map
          </Link>
          {canEdit && (
            <Link to={ADD_ON_MAP} className="on-dark-button">
              <Plus aria-hidden="true" />
              Add intervention
            </Link>
          )}
        </div>
      </section>

      {work.length > 0 && (
        <section className="overview-card work-waiting" aria-labelledby="work-title">
          <h2 id="work-title" className="visually-hidden">
            Work waiting
          </h2>
          <ul>{work}</ul>
        </section>
      )}

      {!canEdit && waiting > 0 && (
        <p className="ui-notice ui-notice-info" role="status">
          <MapPinOff aria-hidden="true" />
          <span>
            {plural(waiting, 'record is', 'records are')} waiting for verified coordinates, so {waiting === 1 ? "it isn't" : "they aren't"} on the map yet. <Link to={AWAITING_LIST}>See the list</Link>
          </span>
        </p>
      )}

      <dl className="overview-tiles" aria-label="Headline figures">
        <Tile id="records" hero label="Interventions" value={count(numbers.records)} note={numbers.types.filter((type) => type.units > 0).map((type) => `${count(type.units)} ${data.types.find((t) => t.id === type.typeId)?.name}`).join(' · ')} />
        <Tile id="beneficiaries" icon={<Users aria-hidden="true" />} label="Beneficiaries" value={count(numbers.beneficiaries)} note="Approximate, by name" />
        <Tile id="barangays" icon={<MapPin aria-hidden="true" />} label="Barangays reached" value={count(numbers.barangaysTotal - numbers.barangaysWithout)} note={`of ${plural(numbers.barangaysTotal, 'barangay')}`} />
        <Tile
          id="operational"
          icon={<Gauge aria-hidden="true" />}
          label="% operational"
          value={operational.percent === null ? '–' : `${operational.percent}%`}
          note={operational.assessed === 0 ? 'No unit assessed yet' : `Of ${plural(operational.assessed, 'assessed unit')}. ${count(notAssessed)} not assessed`}
        />
      </dl>

      <div className="type-cards">
        {typeCards.map(({ type, units, groups, statuses }) => (
          <section key={type.id} className="overview-card type-card" aria-labelledby={`type-${type.id}`}>
            <header className="overview-card-header">
              <div>
                <h2 id={`type-${type.id}`}>{type.name}</h2>
                <p>{groups.length > 1 ? `${plural(units, 'unit')} by category group` : 'Units, by status'}</p>
              </div>
            </header>
            {groups.length > 1 ? <SegmentedBar rows={groups} label={`${type.name} units by category group`} /> : <p className="overview-big-number">{count(units)}</p>}
            {statuses.length > 0 && (
              <ul className="status-pills" aria-label={`${type.name} by status`}>
                {statuses.slice(0, 4).map(({ status, units: statusCount }) => (
                  <li key={status.id}>
                    <span className="status-dot" style={{ background: status.color }} aria-hidden="true" />
                    {status.name} {count(statusCount)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {!hasRoads(data) && (
          <section className="overview-card type-card is-placeholder" aria-labelledby="type-fmr">
            <Route aria-hidden="true" />
            <h2 id="type-fmr">Farm-to-Market Roads</h2>
            <p>Data to follow</p>
          </section>
        )}
      </div>
    </main>
  );
}

export function HomePage({ user, onDataSources }: { user: AppUser; onDataSources(sources: string[]): void }) {
  const state = useMapData(user);
  const sources = state.status === 'ready' ? state.data.dataSources : null;
  useEffect(() => {
    if (sources) onDataSources(sources);
  }, [sources, onDataSources]);
  if (state.status === 'loading') return <p className="page-message is-loading">Loading…</p>;
  if (state.status === 'error') {
    return (
      <div className="page-message" role="alert">
        <h2>This page could not load</h2>
        <p>{state.error.message}</p>
      </div>
    );
  }
  return <Home data={state.data} user={user} />;
}
