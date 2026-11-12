// The inventory report: the RAED Consolidated Inventory Report's layout, for any municipality, program and
// year, as a PDF or an Excel workbook.
import { Download, FileSpreadsheet, SearchX } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { MapData } from '../data/types';
import { manilaToday } from '../lib/dates';
import { EmptyState } from '../overview/EmptyState';
import { inventorySections, inventoryTitle, NO_INVENTORY_FILTERS, reportRecords, type InventoryFilters } from './report-data';
import { namePart, useReportDownload, type ReportFile } from './use-report-download';

// Enough to see what's in it. The files have every row.
const PREVIEW_ROWS = 25;

export function InventoryReport({ data }: { data: MapData }) {
  const id = useId();
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
    <section className="report-section" aria-label="Inventory report">
      <div className="overview-card report-controls">
        <header className="overview-card-header">
          <div>
            <h2>Inventory report</h2>
            <p>In the layout of the RAED Consolidated Inventory Report: legal paper, landscape, a table for each type in the same columns.</p>
          </div>
          <div className="report-downloads">
            <button
              type="button"
              className="ui-button ui-button-secondary"
              disabled={busy !== null || records === 0}
              onClick={() =>
                void run('xlsx', async () => {
                  const { inventoryXlsx } = await import('./inventory-xlsx');
                  return logged('xlsx', (await inventoryXlsx({ data, filters, signatories: data.signatories, now: new Date() })).bytes);
                })
              }
            >
              <FileSpreadsheet aria-hidden="true" />
              {busy === 'xlsx' ? 'Making the workbook…' : 'Download Excel'}
            </button>
            <button
              type="button"
              className="ui-button ui-button-primary"
              disabled={busy !== null || records === 0}
              onClick={() =>
                void run('pdf', async () => {
                  const { inventoryPdf } = await import('./inventory-pdf');
                  return logged('pdf', inventoryPdf({ data, filters, signatories: data.signatories, now: new Date() }).bytes);
                })
              }
            >
              <Download aria-hidden="true" />
              {busy === 'pdf' ? 'Making the PDF…' : 'Download PDF'}
            </button>
          </div>
        </header>

        <form className="filter-bar-fields" aria-label="Choose what the inventory covers" onSubmit={(event) => event.preventDefault()}>
          <div className="filter-field is-wide">
            <label htmlFor={`${id}-municipality`}>Municipality</label>
            <select id={`${id}-municipality`} value={filters.municipalityId ?? ''} onChange={(event) => change({ municipalityId: event.target.value ? Number(event.target.value) : null })}>
              <option value="">All of Marinduque</option>
              {data.municipalities.map((municipality) => (
                <option key={municipality.id} value={municipality.id}>
                  {municipality.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field is-wide">
            <label htmlFor={`${id}-program`}>Banner program</label>
            <select id={`${id}-program`} value={filters.programId ?? ''} onChange={(event) => change({ programId: event.target.value ? Number(event.target.value) : null })}>
              <option value="">All programs</option>
              {data.programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor={`${id}-year`}>Year funded</label>
            <select id={`${id}-year`} value={filters.year ?? ''} onChange={(event) => change({ year: event.target.value ? Number(event.target.value) : null })}>
              <option value="">All years</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </form>
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
      </div>

      <div className="report-heading report-title-block">
        <strong>{heading.title}</strong>
        <span>{heading.subtitle}</span>
        <span>{heading.place}</span>
        {heading.filters.length > 0 && <span className="report-note">{heading.filters.join('; ')}</span>}
        <span className="report-count" role="status">
          {records === 0 ? 'No records match these choices.' : `${records} ${records === 1 ? 'record' : 'records'}, ${units} ${units === 1 ? 'unit' : 'units'}.`}
        </span>
      </div>

      {records === 0 && (
        <div className="overview-card">
          <EmptyState icon={SearchX} title="Nothing to list">
            Choose another municipality, program or year.
          </EmptyState>
        </div>
      )}

      {sections.map((section) => (
        <section key={section.type.id} className="overview-card report-block" aria-label={section.type.name} data-type={section.type.code}>
          <header className="report-block-header">
            <h3>
              <span className="pill-dot" style={{ background: section.type.color }} aria-hidden="true" />
              {section.type.name} <span className="count">{section.records.length}</span>
            </h3>
            {section.rows.length > PREVIEW_ROWS && <p>The first {PREVIEW_ROWS} of {section.rows.length} rows. The PDF and Excel files have them all.</p>}
          </header>
          <div className="table-scroll report-table-scroll">
            <table className="data-table report-table inventory-table">
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
        </section>
      ))}
    </section>
  );
}
