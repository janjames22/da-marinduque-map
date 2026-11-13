import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Intervention } from '../data/types';
import type { ChoroplethMode, Shading } from '../lib/choropleth';
import { DEFAULT_COLOR_BY, type ColorScale } from '../lib/view-fields';

interface LegendProps {
  mode: ChoroplethMode;
  shading: Shading;
  totalBarangays: number;
  unassigned: number;
  scale: ColorScale;
  markers: Intervention[];
  // Roads drawn on the map, by whether they're finished.
  roads: { finished: number; unfinished: number };
  onShowUnassigned(): void;
}

// A road's line takes its color from Color by, like a marker. What the legend adds is the dashes.
function RoadLegend({ roads }: { roads: LegendProps['roads'] }) {
  const rows = [
    { key: 'finished', label: 'Completed or in use', count: roads.finished },
    { key: 'unfinished', label: 'Proposed or on-going', count: roads.unfinished },
  ].filter((row) => row.count > 0);
  if (rows.length === 0) return null;
  return (
    <>
      <h2 className="legend-title legend-roads-title">Roads</h2>
      <ul aria-label="Road lines">
        {rows.map((row) => (
          <li key={row.key}>
            <span className={`line-swatch${row.key === 'unfinished' ? ' is-dashed' : ''}`} aria-hidden="true" />
            <span>{row.label}</span>
            <span className="count">{row.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// Colors alone can't say what they mean, so each comes with its words and how many are showing.
function MarkerLegend({ scale, markers }: { scale: ColorScale; markers: Intervention[] }) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of markers) {
      const key = scale.keyOf(record);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return scale.entries.map((entry) => ({ ...entry, count: counts.get(entry.key) ?? 0 })).filter((entry) => entry.count > 0);
  }, [scale, markers]);

  return (
    // Programs are the usual colors, so that list stays folded until it's wanted.
    <details className="legend-markers" open={scale.field !== DEFAULT_COLOR_BY}>
      <summary className="legend-title">Markers by {scale.title.toLowerCase()}</summary>
      <ul aria-label={`Marker colors by ${scale.title}`}>
        {rows.map((entry) => (
          <li key={entry.key}>
            <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
            <span>{entry.label}</span>
            <span className="count">{entry.count}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// A phone's legend starts folded, and keeps to its own height (map-phone.css).
const PHONE = '(max-width: 800px)';
// Room between the legend and the buttons above it.
const CLEARANCE = 12;
// Below this, a computer's legend starts folded: too little room to read it open.
const ROOMY = 240;
// How long the fold takes (map.css), before the folded body leaves the layout.
const FOLD_MS = 240;

const lessMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Folding is seen through: the body stays laid out while it shrinks, then leaves the layout, so the folded
// legend is a small button. Unfolding brings it back first, then grows it on the next frames.
function useFold(open: boolean) {
  const [laidOut, setLaidOut] = useState(open);
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (open) {
      setLaidOut(true);
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setExpanded(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    setExpanded(false);
    const timer = setTimeout(() => setLaidOut(false), lessMotion() ? 0 : FOLD_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { laidOut, expanded };
}

// How tall the legend may be, so it never runs under the zoom, full screen and layers buttons above it
// on the map's left. Null on a phone, whose buttons are elsewhere.
function useRoomForLegend(legend: RefObject<HTMLDivElement | null>): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const element = legend.current;
    const area = element?.parentElement;
    if (!element || !area) return;
    const measure = () => {
      if (globalThis.matchMedia?.(PHONE).matches) {
        setRoom(null);
        return;
      }
      const box = area.getBoundingClientRect();
      const controls = area.querySelector('.leaflet-top.leaflet-left');
      const above = controls ? controls.getBoundingClientRect().bottom - box.top : 0;
      const below = Number.parseFloat(getComputedStyle(element).bottom) || 0;
      setRoom(Math.max(0, Math.floor(box.height - above - below - CLEARANCE)));
    };
    measure();
    // The map's size, and the buttons above, as one comes or goes.
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    const controls = area.querySelector('.leaflet-top.leaflet-left');
    if (controls) observer.observe(controls);
    return () => observer.disconnect();
  }, [legend]);
  return room;
}

export function Legend({ mode, shading, totalBarangays, unassigned, scale, markers, roads, onShowUnassigned }: LegendProps) {
  const ref = useRef<HTMLDivElement>(null);
  const room = useRoomForLegend(ref);
  // Open when there's room for it, folded into a small button when there isn't, as on a phone, until the
  // person chooses. The choice then stands.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? (room !== null && room >= ROOMY);
  const { laidOut, expanded } = useFold(open);
  const style = room === null ? undefined : ({ '--legend-room': `${room}px` } as CSSProperties);
  return (
    <div ref={ref} className={`legend${expanded ? ' is-open' : ''}${laidOut ? '' : ' is-folded'}`} aria-label="Map legend" style={style}>
      <button type="button" className="legend-toggle" aria-expanded={open} onClick={() => setChosen(!open)}>
        <span className="legend-toggle-swatches" aria-hidden="true">
          {(mode === 'off' ? [] : shading.legend.slice(-3)).map((entry) => (
            <span key={entry.label} style={{ background: entry.color }} />
          ))}
        </span>
        {open ? 'Hide legend' : 'Legend'}
      </button>
      {/* Folds and unfolds smoothly on a computer (map.css). */}
      <div className="legend-fold">
      <div className="legend-body">
      {mode !== 'off' && (
        <>
          <h2 className="legend-title">{shading.title}</h2>
          <ul>
            {shading.legend.map((entry) => (
              <li key={entry.label}>
                <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
                <span>{entry.label}</span>
                <span className="count">{entry.barangays}</span>
              </li>
            ))}
          </ul>
          <p className="legend-note">
            {mode === 'gap'
              ? 'Shows what has been encoded, not what exists on the ground.'
              : 'Number of barangays beside each class.'}
          </p>
        </>
      )}
      <p className="legend-summary">
        {shading.barangaysWithRecords} of {totalBarangays} barangays have records
      </p>
      {unassigned > 0 && (
        <button type="button" className="link-button" onClick={onShowUnassigned}>
          Unassigned: {unassigned} {unassigned === 1 ? 'record' : 'records'}
        </button>
      )}
      <RoadLegend roads={roads} />
      <MarkerLegend scale={scale} markers={markers} />
      </div>
      </div>
    </div>
  );
}
