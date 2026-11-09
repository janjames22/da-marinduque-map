// Making a report's file, logging it as an export, then handing it over. As with every export, the file
// leaves only once the log has it, so no download goes unrecorded.
import { useState } from 'react';
import { downloadFile } from '../lib/download';
import { useStore } from '../state/store-context';

export interface ReportFile {
  bytes: Uint8Array;
  fileName: string;
  format: 'pdf' | 'xlsx';
  records: number;
  // What it covered, for the audit log.
  filters: Record<string, unknown>;
}

const TYPES = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

export function useReportDownload() {
  const { store } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (id: string, make: () => Promise<ReportFile | null>) => {
    setBusy(id);
    setFailure(null);
    try {
      const file = await make();
      if (!file) throw new Error('There is nothing to put in this report.');
      await store.logExport({ format: file.format, file_name: file.fileName, filters: file.filters, record_count: file.records });
      downloadFile(file.bytes, file.fileName, TYPES[file.format]);
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return { busy, failure, run };
}

// A file name part from a place or program: letters and digits only, as the other exports name files.
export const namePart = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, '');
