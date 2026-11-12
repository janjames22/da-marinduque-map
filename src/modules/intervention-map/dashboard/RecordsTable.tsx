// The records as a table: the same ones the map, charts and exports show, sorted and searched here.
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { useEffect, useMemo } from 'react';
import type { Intervention, MapData } from '../data/types';
import { dismissedKeys, encodedPlace, FLAG_LABELS, isOnMap, needsReview, recordName, unplottedLabel } from '../lib/display';
import { foldText } from '../lib/view-fields';
import { useEditUi } from '../state/edit-ui';
import { useExportUi } from '../state/export-ui';
import { useMapUi } from '../state/map-ui';

const PAGE_SIZES = [25, 50, 100];

export interface TableState {
  search: string;
  sorting: SortingState;
  pagination: PaginationState;
}

interface TableRow {
  record: Intervention;
  name: string;
  beneficiary: string | undefined;
  type: string | undefined;
  program: string | undefined;
  year: number | undefined;
  status: string | undefined;
  municipality: string | undefined;
  barangay: string | undefined;
  units: number;
  qa: string | undefined;
  search: string;
}

function toRows(records: Intervention[], data: MapData): TableRow[] {
  const dismissed = dismissedKeys(data.qaDismissals);
  const nameOf = <T extends { id: number; name: string }>(items: T[], id: number | null) => items.find((item) => item.id === id)?.name;
  return records.map((record) => {
    const row = {
      record,
      name: recordName(record, data),
      beneficiary: record.beneficiary ?? undefined,
      type: nameOf(data.types, record.intervention_type_id),
      program: nameOf(data.programs, record.banner_program_id),
      year: record.year_funded ?? undefined,
      status: nameOf(data.statuses, record.status_id),
      municipality: nameOf(data.municipalities, record.municipality_id),
      barangay: nameOf(data.barangays, record.barangay_id) ?? record.barangay_raw ?? undefined,
      units: record.quantity,
      qa: needsReview(record, dismissed) ? record.qa_flags.filter((flag) => flag !== 'duplicate_point' && !dismissed.has(`${record.id}|${flag}`)).map((flag) => FLAG_LABELS[flag] ?? flag).join('; ') : undefined,
    };
    const search = foldText([row.name, row.beneficiary, row.type, row.program, row.year, row.status, row.municipality, row.barangay, row.qa, record.source_id, record.remarks].filter(Boolean).join(' '));
    return { ...row, search };
  });
}

const COLUMNS: ColumnDef<TableRow>[] = [
  { id: 'name', accessorKey: 'name', header: 'Record', sortUndefined: 'last' },
  { id: 'beneficiary', accessorKey: 'beneficiary', header: 'Beneficiary', sortUndefined: 'last' },
  { id: 'type', accessorKey: 'type', header: 'Type', sortUndefined: 'last' },
  { id: 'program', accessorKey: 'program', header: 'Program', sortUndefined: 'last' },
  { id: 'year', accessorKey: 'year', header: 'Year', sortUndefined: 'last' },
  { id: 'status', accessorKey: 'status', header: 'Status', sortUndefined: 'last' },
  { id: 'municipality', accessorKey: 'municipality', header: 'Municipality', sortUndefined: 'last' },
  { id: 'barangay', accessorKey: 'barangay', header: 'Barangay', sortUndefined: 'last' },
  { id: 'units', accessorKey: 'units', header: 'Units', sortUndefined: 'last' },
  { id: 'qa', accessorKey: 'qa', header: 'QA', sortUndefined: 'last' },
];

interface RecordsTableProps {
  records: Intervention[];
  data: MapData;
  state: TableState;
  onChange(changes: Partial<TableState>): void;
  // The Interventions page opens the record's own page. Beside the map, a row shows the record there.
  onOpen?(record: Intervention): void;
  // Marks the records that aren't on the map, where there's no map beside the table to show it.
  markUnplotted?: boolean;
}

export function RecordsTable({ records, data, state, onChange, onOpen, markUnplotted = false }: RecordsTableProps) {
  const rows = useMemo(() => toRows(records, data), [records, data]);

  const table = useReactTable({
    data: rows,
    columns: COLUMNS,
    getRowId: (row) => row.record.id,
    state: { globalFilter: state.search, sorting: state.sorting, pagination: state.pagination },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getColumnCanGlobalFilter: () => true,
    // The first click goes up on every column, numbers included.
    sortDescFirst: false,
    globalFilterFn: (row, _column, value: string) => row.original.search.includes(foldText(value)),
    onSortingChange: (updater) => onChange({ sorting: typeof updater === 'function' ? updater(state.sorting) : updater }),
    onPaginationChange: (updater) => onChange({ pagination: typeof updater === 'function' ? updater(state.pagination) : updater }),
    // A change from someone else mustn't send the reader back to the first page.
    autoResetPageIndex: false,
  });

  const matching = table.getPrePaginationRowModel().rows;
  const { pageIndex, pageSize } = state.pagination;
  const lastPage = Math.max(0, Math.ceil(matching.length / pageSize) - 1);

  // Fewer rows can leave the reader past the end.
  useEffect(() => {
    if (pageIndex > lastPage) onChange({ pagination: { pageIndex: lastPage, pageSize } });
  }, [pageIndex, lastPage, pageSize, onChange]);

  const goTo = (record: Intervention) => {
    if (onOpen) {
      onOpen(record);
      return;
    }
    const ui = useMapUi.getState();
    if (globalThis.matchMedia?.('(max-width: 800px)').matches) ui.setInsights(null);
    if (isOnMap(record)) {
      ui.zoomToRecord(record.id);
      return;
    }
    // It can't be pointed at, so the nearest thing is where it was encoded.
    if (record.barangay_id !== null) ui.zoomToBarangay(record.barangay_id);
    useEditUi.getState().setNotice(`This record has no usable coordinates, so it isn't on the map. It's encoded in ${encodedPlace(record, data) || 'no barangay yet'}.`);
  };

  const exportTable = () => {
    const ui = useMapUi.getState();
    useExportUi.getState().openTableExport({
      recordIds: matching.map((row) => row.original.record.id),
      search: state.search.trim() || null,
      // Away from the map (the Interventions page) there's no map view to keep to.
      onlyMapView: onOpen ? false : ui.limitToMapView,
    });
  };

  const first = matching.length === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, matching.length);

  return (
    <section className="records-table-section" aria-label="Records table">
      <div className="records-toolbar">
        <label className="field records-search">
          <span>Search these records</span>
          <input
            type="search"
            value={state.search}
            onChange={(event) => onChange({ search: event.target.value, pagination: { pageIndex: 0, pageSize } })}
          />
        </label>
        <button type="button" className="export-button" disabled={matching.length === 0} onClick={exportTable}>
          Export this table
        </button>
      </div>

      {matching.length === 0 ? (
        <p className="empty-note">No records match.</p>
      ) : (
        <div className="records-scroll">
          <table className="records-table">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th key={header.id} scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}>
                        <button type="button" onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden="true">{sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} data-record={row.id} onClick={() => goTo(row.original.record)}>
                  {row.getVisibleCells().map((cell) =>
                    cell.column.id === 'name' ? (
                      <td key={cell.id}>
                        {/* The row takes the click, and this makes it reachable by keyboard. */}
                        <button type="button" className="link-button">
                          {row.original.name}
                        </button>
                        {markUnplotted && !isOnMap(row.original.record) && <span className="unplotted-badge">{unplottedLabel(row.original.record, data)}</span>}
                      </td>
                    ) : (
                      <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="records-pages">
        <span className="records-count" role="status">
          {first}–{last} of {matching.length}
        </span>
        <label className="records-page-size">
          Show
          <select value={pageSize} onChange={(event) => onChange({ pagination: { pageIndex: 0, pageSize: Number(event.target.value) } })}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-button" disabled={pageIndex === 0} onClick={() => onChange({ pagination: { pageIndex: pageIndex - 1, pageSize } })}>
          Previous
        </button>
        <button type="button" className="secondary-button" disabled={pageIndex >= lastPage} onClick={() => onChange({ pagination: { pageIndex: pageIndex + 1, pageSize } })}>
          Next
        </button>
      </div>
    </section>
  );
}
