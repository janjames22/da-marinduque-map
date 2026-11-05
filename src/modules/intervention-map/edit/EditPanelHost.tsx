import type { MapData } from '../data/types';
import { useEditUi } from '../state/edit-ui';
import { InterventionForm } from './InterventionForm';
import { DeletedPanel, DeleteForm, HistoryPanel } from './RecordPanels';
import { ResolveForm } from './ResolveForm';
import { StatusForm } from './StatusForm';

export function EditPanelHost({ data }: { data: MapData }) {
  const panel = useEditUi((state) => state.panel);
  if (!panel) return null;

  if (panel.kind === 'add') return <InterventionForm key="add" data={data} record={null} prefill={panel.prefill} />;
  if (panel.kind === 'deleted') return <DeletedPanel data={data} />;

  const record = data.interventions.find((r) => r.id === panel.id);
  if (!record) return null;

  // The key gives each record's form its own state.
  switch (panel.kind) {
    case 'edit':
      return <InterventionForm key={record.id} data={data} record={record} />;
    case 'status':
      return <StatusForm key={record.id} data={data} record={record} />;
    case 'resolve':
      return <ResolveForm key={record.id} data={data} record={record} />;
    case 'delete':
      return <DeleteForm key={record.id} data={data} record={record} />;
    case 'history':
      return <HistoryPanel key={record.id} data={data} record={record} />;
  }
}
