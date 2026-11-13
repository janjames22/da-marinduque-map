// A place among the map's own controls for buttons from the page, so Leaflet stacks them with the zoom
// buttons and the attribution, clear of the legend, the toolbar and each other.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';

export function ControlSlot({ position, className, children }: { position: L.ControlPosition; className?: string; children: ReactNode }) {
  const map = useMap();
  const [container] = useState(() => {
    const element = L.DomUtil.create('div', `leaflet-control map-control-slot${className ? ` ${className}` : ''}`);
    // A click or a scroll on a button is the button's, not the map's.
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return element;
  });

  useEffect(() => {
    const Slot = L.Control.extend({ onAdd: () => container });
    const control = new Slot({ position });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, position, container]);

  return createPortal(children, container);
}
