// What a card shows when it has nothing to list: an icon, a title, a line of help, and maybe a way on.
import { Inbox, MapPinned, SearchX, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { isNarrowed, useMapUi } from '../state/map-ui';

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon />
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// No records to show. When filters, layers, shading or the map view are narrowing them, it says so
// and offers a way back to all of them, rather than a page of zeroes that reads as if nothing was ever
// encoded. `mapView` is for the map's own panel, where "Limit to map view" can be on.
export function NoRecords({ mapView = false }: { mapView?: boolean }) {
  const ui = useMapUi();
  if (isNarrowed(ui)) {
    return (
      <EmptyState
        icon={SearchX}
        title="No records match these filters"
        action={
          <button type="button" className="ui-button ui-button-secondary" onClick={ui.showEverything}>
            Show all records
          </button>
        }
      >
        Change the filters or the layers, or show every record again.
      </EmptyState>
    );
  }
  if (mapView && ui.limitToMapView) {
    return (
      <EmptyState
        icon={MapPinned}
        title="No records in this part of the map"
        action={
          <button type="button" className="ui-button ui-button-secondary" onClick={() => ui.setLimitToMapView(false)}>
            Count the whole province
          </button>
        }
      >
        Move or zoom out the map, or count every record, not only those in view.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={Inbox} title="No records yet">
      Records appear here once they're encoded or imported.
    </EmptyState>
  );
}
