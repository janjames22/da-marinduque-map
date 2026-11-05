// leaflet.markercluster attaches itself to a global L, so this must be imported before it.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

declare global {
  interface Window {
    L: typeof L;
  }
}

window.L = L;

export default L;
