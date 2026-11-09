// The inventory report: the RAED Consolidated Inventory Report's layout, for any municipality, program and
// year, as a PDF or an Excel workbook.
import { useMemo, useState } from 'react';
import type { MapData } from '../data/types';
import { manilaToday } from '../lib/dates';
import { inventorySections, inventoryTitle, NO_INVENTORY_FILTERS, reportRecords, type InventoryFilters } from './report-data';
import { namePart, useReportDownload, type ReportFile } from './use-report-download';

// Enough to see what's in it. The files have every row.
const PREVIEW_ROWS = 25;

export function InventoryReport({ data }: { data: MapData }) {
  const [filters, setFilters] = useState<InventoryFilters>(NO_INVENTORY_FILTERS);
  const { busy, failure, run } = useReportDownload();
  const sections = useMemo(() => inventorySections(data, filters), [data, filters]);
  const heading = inventoryTitle(sections, filters, data);
  const years = useMemo(() => [...new Set(reportRecords(data).map((record) => record.year_funded).filter((year): year is number => year !== null))].sort((a, b) => b - a), [data]);
  const records = sections.reduce((sum, section) => sum + section.records.length, 0);
  const units = sections.reduce((sum, section) => sum + section.units, 0);

  const change = (changes: Partial<InventoryFilters>) => setFilters((current) => ({ ...current, ...changes }));
  const stem = () => {
    const municipality = data.municipalities.find((m) => m.id === filters.municipalityId)?.name;
    const program = data.programs.find((p) => p.id === filters.programId)?.name;
    return ['Inventory', namePart(municipality ?? 'Marinduque'), program ? namePart(program) : null, filters.year === null ? null : String(filters.year), manilaToday()].filter(Boolean).join('_');
  };
  const logged = (format: 'pdf' | 'xlsx', bytes: Uint8Array): ReportFile => ({
    bytes,
    fileName: `${stem()}.${format}`,
    format,
    records,
    filters: { report: 'inventory', municipality: heading.place, program: data.programs.find((p) => p.id === filters.programId)?.name ?? null, year: filters.year },
  });

  return (
    <section className="admin-section report-section" aria-label="Inventory report">
      <header className="admin-section-header">
        <div>
          <h2>Inventory report</h2>
          <p className="field-hint">In the layout of the RAED Consolidated Inventory Report: legal paper, landscape, a table for each type in the same columns. Every record on the map, whatever the map's filters.</p>
        </div>
      </header>

      <form className="audit-filters" aria-label="Choose what the inventory covers" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span>Municipality</span>
          <select value={filters.municipalityId ?? ''} onChange={(event) => change({ municipalityId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All of Marinduque</option>
            {data.municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Banner program</span>
          <select value={filters.programId ?? ''} onChange={(event) => change({ programId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All programs</option>
            {data.programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Year funded</span>
          <select value={filters.year ?? ''} onChange={(event) => change({ year: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All years</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </form>

      <div className="report-heading">
        <strong>{heading.title}</strong>
        <span>{heading.subtitle}</span>
        <span>{heading.place}</span>
        {heading.filters.length > 0 && <span className="field-hint">{heading.filters.join('; ')}</span>}
      </div>
      <p className="records-count" role="status">
        {records === 0 ? 'No records match these choices.' : `${records} ${records === 1 ? 'record' : 'records'}, ${units} ${units === 1 ? 'unit' : 'units'}.`}
      </p>

      <div className="form-actions report-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy !== null || records === 0}
          onClick={() =>
            void run('pdf', async () => {
              const { inventoryPdf } = await import('./inventory-pdf');
              return logged('pdf', inventoryPdf({ data, filters, signatories: data.signatories, now: new Date() }).bytes);
            })
          }
        >
          {busy === 'pdf' ? 'Making the PDF…' : 'Download PDF'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy !== null || records === 0}
          onClick={() =>
            void run('xlsx', async () => {
              const { inventoryXlsx } = await import('./inventory-xlsx');
              return logged('xlsx', (await inventoryXlsx({ data, filters, signatories: data.signatories, now: new Date() })).bytes);
            })
          }
        >
          {busy === 'xlsx' ? 'Making the workbook…' : 'Download Excel'}
        </button>
      </div>
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}

      {sections.map((section) => (
        <section key={section.type.id} className="report-block" aria-label={section.type.name} data-type={section.type.code}>
          <h3>
            {section.type.name} <span className="count">{section.records.length}</span>
          </h3>
          <div className="records-scroll">
            <table className="records-table report-table">
              <thead>
                <tr>
                  {section.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                  <tr key={section.records[index].id}>
                    {row.map((value, column) => (
                      <td key={column}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {section.rows.length > PREVIEW_ROWS && <p className="field-hint">The first {PREVIEW_ROWS} of {section.rows.length} rows. The PDF and Excel files have them all.</p>}
        </section>
      ))}
    </section>
  );
}
