// The dashboard's charts. Marks stay thin and the grid stays quiet, so the data is what stands out. A
// value is never only in a tooltip: every chart has a table beside it, one button away.
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Rectangle, ResponsiveContainer, Text, Tooltip, XAxis, YAxis } from 'recharts';
import type { BarRow, DashboardNumbers, StatusRow, StatusSeries } from '../lib/dashboard';

// One measure, so one color: the same blue as the map's count shading.
const MEASURE_COLOR = '#2a78d6';
const INK_SECONDARY = '#52514e';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const SURFACE = '#ffffff';
const HOVER_WASH = 'rgb(0 0 0 / 4%)';

const ROW_HEIGHT = 30;
const BAR_THICKNESS = 16;
const COLUMN_MAX_WIDTH = 24;

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

function ChartCard({ title, note, table, children }: { title: string; note?: string; table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="chart-card" aria-label={title}>
      <figcaption>
        <h3>{title}</h3>
        <button type="button" className="link-button" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Show chart' : 'Show table'}
          <span className="visually-hidden"> for {title}</span>
        </button>
      </figcaption>
      {note && <p className="field-hint">{note}</p>}
      {asTable ? table : children}
    </figure>
  );
}

function RowsTable({ rows, heading }: { rows: BarRow[]; heading: string }) {
  return (
    <table className="chart-table">
      <thead>
        <tr>
          <th scope="col">{heading}</th>
          <th scope="col">Units</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{row.value.toLocaleString('en-US')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  color?: string;
  fill?: string;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
}

// The value leads, as the reader already has the series and wants the number.
function ChartTooltip({ active, payload, label, rows }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number; rows?: StatusSeries[] }) {
  if (!active || !payload?.length) return null;
  const shown = rows
    ? rows.flatMap((series) => {
        const entry = payload.find((candidate) => String(candidate.name) === series.label);
        return entry && Number(entry.value) > 0 ? [{ key: series.key, color: series.color, label: series.label, value: Number(entry.value) }] : [];
      })
    : [];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{label}</div>
      {rows ? (
        shown.map((row) => (
          <div className="chart-tooltip-row" key={row.key}>
            <span className="chart-tooltip-key" style={{ background: row.color }} aria-hidden="true" />
            <strong>{row.value.toLocaleString('en-US')}</strong> {row.label}
          </div>
        ))
      ) : (
        <div className="chart-tooltip-row">
          <strong>{Number(payload[0].value).toLocaleString('en-US')}</strong> units
        </div>
      )}
    </div>
  );
}

function BarLabel({ x, y, payload, width }: { x?: number | string; y?: number | string; payload?: { value?: string }; width: number }) {
  return (
    <Text x={Number(x)} y={Number(y)} width={width} textAnchor="end" verticalAnchor="middle" maxLines={2} fontSize={12} fill={INK_SECONDARY}>
      {payload?.value ?? ''}
    </Text>
  );
}

// Ranked bars, each named on its axis, with its value at the tip.
function HorizontalBars({ rows, labelWidth = 104 }: { rows: BarRow[]; labelWidth?: number }) {
  return (
    <ResponsiveContainer width="100%" height={rows.length * ROW_HEIGHT + 4}>
      <BarChart layout="vertical" data={rows} margin={{ top: 2, right: 36, bottom: 2, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} domain={[0, 'dataMax']} />
        <YAxis
          type="category"
          dataKey="label"
          width={labelWidth}
          interval={0}
          tickLine={false}
          axisLine={{ stroke: AXIS }}
          tick={(props: { x?: number | string; y?: number | string; payload?: { value?: string } }) => <BarLabel {...props} width={labelWidth - 8} />}
        />
        <Tooltip cursor={{ fill: HOVER_WASH }} isAnimationActive={false} content={(props) => <ChartTooltip active={props.active} payload={props.payload as readonly TooltipEntry[]} label={props.label as string} />} />
        <Bar dataKey="value" barSize={BAR_THICKNESS} radius={[0, 4, 4, 0]} isAnimationActive={false} fill={MEASURE_COLOR}>
          {rows.map((row) => (
            <Cell key={row.key} fill={row.color ?? MEASURE_COLOR} />
          ))}
          <LabelList dataKey="value" position="right" fontSize={12} fill={INK_SECONDARY} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function YearColumns({ rows }: { rows: BarRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fontSize: 12, fill: INK_SECONDARY }} minTickGap={8} />
        <YAxis width={32} allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK_SECONDARY }} />
        <Tooltip cursor={{ fill: HOVER_WASH }} isAnimationActive={false} content={(props) => <ChartTooltip active={props.active} payload={props.payload as readonly TooltipEntry[]} label={props.label as string} />} />
        <Bar dataKey="value" maxBarSize={COLUMN_MAX_WIDTH} radius={[4, 4, 0, 0]} fill={MEASURE_COLOR} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// A row's last segment takes the rounded end, and the white edge keeps close colors apart.
function StackSegment(props: { x?: number; y?: number; width?: number; height?: number; fill?: string; dataKey?: unknown; payload?: { order?: string[] } }) {
  const { x = 0, y = 0, width = 0, height = 0, fill, dataKey, payload } = props;
  if (width <= 0) return null;
  const last = payload?.order?.at(-1) === String(dataKey);
  return <Rectangle x={x} y={y} width={width} height={height} fill={fill} stroke={SURFACE} strokeWidth={2} radius={last ? [0, 4, 4, 0] : 0} />;
}

function StatusStacks({ rows, series }: { rows: StatusRow[]; series: StatusSeries[] }) {
  const chartRows = rows.map((row) => ({
    label: row.label,
    order: series.filter((entry) => (row.values[entry.key] ?? 0) > 0).map((entry) => `values.${entry.key}`),
    values: row.values,
  }));
  return (
    <>
      <ResponsiveContainer width="100%" height={rows.length * ROW_HEIGHT + 4}>
        <BarChart layout="vertical" data={chartRows} margin={{ top: 2, right: 12, bottom: 2, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={80} interval={0} tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fontSize: 12, fill: INK_SECONDARY }} />
          <Tooltip cursor={{ fill: HOVER_WASH }} isAnimationActive={false} content={(props) => <ChartTooltip active={props.active} payload={props.payload as readonly TooltipEntry[]} label={props.label as string} rows={series} />} />
          {series.map((entry) => (
            <Bar key={entry.key} dataKey={`values.${entry.key}`} name={entry.label} stackId="status" fill={entry.color} barSize={BAR_THICKNESS} isAnimationActive={false} shape={<StackSegment />} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ul className="chart-legend" aria-label="Status colors">
        {series.map((entry) => (
          <li key={entry.key}>
            <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
            {entry.label}
          </li>
        ))}
      </ul>
    </>
  );
}

function StatusTable({ rows, series }: { rows: StatusRow[]; series: StatusSeries[] }) {
  return (
    <div className="chart-table-scroll">
      <table className="chart-table">
        <thead>
          <tr>
            <th scope="col">Municipality</th>
            {series.map((entry) => (
              <th scope="col" key={entry.key}>
                {entry.label}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {series.map((entry) => (
                <td key={entry.key}>{(row.values[entry.key] ?? 0).toLocaleString('en-US')}</td>
              ))}
              <td>{row.total.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ id, label, value, note }: { id: string; label: string; value: string; note?: string }) {
  return (
    <div className="kpi" data-kpi={id}>
      <dt>{label}</dt>
      <dd className="kpi-value">{value}</dd>
      {note && <dd className="kpi-note">{note}</dd>}
    </div>
  );
}

export function DashboardView({ numbers }: { numbers: DashboardNumbers }) {
  const { operational } = numbers;
  return (
    <>
      <dl className="kpi-grid" aria-label="Key figures">
        <Tile id="records" label="Total interventions" value={numbers.records.toLocaleString('en-US')} />
        {numbers.types.map((type) => (
          <Tile key={type.typeId} id={`type-${type.typeId}`} label={type.label} value={type.units.toLocaleString('en-US')} />
        ))}
        <Tile id="beneficiaries" label="Beneficiary FCAs served" value={numbers.beneficiaries.toLocaleString('en-US')} />
        <Tile
          id="operational"
          label="% operational"
          value={operational.percent === null ? '–' : `${operational.percent}%`}
          note={operational.percent === null ? 'No known status' : `${operational.units.toLocaleString('en-US')} of ${plural(operational.known, 'unit')} with a known status`}
        />
        <Tile id="barangays-without" label="Barangays with no intervention yet" value={numbers.barangaysWithout.toLocaleString('en-US')} note={`of ${plural(numbers.barangaysTotal, 'barangay')}`} />
        <Tile id="needing-qa" label="Records needing QA" value={numbers.needingQa.toLocaleString('en-US')} />
      </dl>

      {numbers.records === 0 ? (
        <p className="empty-note">No records match these filters, so there's nothing to chart.</p>
      ) : (
        <>
          <ChartCard title="Units by municipality" table={<RowsTable rows={numbers.byMunicipality} heading="Municipality" />}>
            <HorizontalBars rows={numbers.byMunicipality} labelWidth={88} />
          </ChartCard>
          <ChartCard title="Units by program" table={<RowsTable rows={numbers.byProgram} heading="Program" />}>
            <HorizontalBars rows={numbers.byProgram} labelWidth={150} />
          </ChartCard>
          <ChartCard
            title="Units by year funded"
            note={numbers.noYearUnits > 0 ? `Not shown: ${plural(numbers.noYearUnits, 'unit')} with no year.` : undefined}
            table={<RowsTable rows={numbers.byYear} heading="Year" />}
          >
            <YearColumns rows={numbers.byYear} />
          </ChartCard>
          <ChartCard
            title={numbers.categoriesLeftOut > 0 ? 'Units by category (top 15)' : 'Units by category'}
            note={numbers.categoriesLeftOut > 0 ? `Not shown: ${numbers.categoriesLeftOut} smaller ${numbers.categoriesLeftOut === 1 ? 'category' : 'categories'}, with ${plural(numbers.unitsLeftOut, 'unit')}.` : undefined}
            table={<RowsTable rows={numbers.byCategory} heading="Category" />}
          >
            <HorizontalBars rows={numbers.byCategory} labelWidth={150} />
          </ChartCard>
          <ChartCard title="Status by municipality" table={<StatusTable rows={numbers.byStatus} series={numbers.statusSeries} />}>
            <StatusStacks rows={numbers.byStatus} series={numbers.statusSeries} />
          </ChartCard>
        </>
      )}
    </>
  );
}
