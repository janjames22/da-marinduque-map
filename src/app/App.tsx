import { useState } from 'react';
import { MapPage } from '../modules/intervention-map/MapPage';

export function App() {
  const [dataSources, setDataSources] = useState<string[]>([]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span className="app-agency">Department of Agriculture – Provincial Agriculture Office, Marinduque</span>
          <h1>Intervention Map</h1>
        </div>
      </header>

      <MapPage onDataSources={setDataSources} />

      <footer className="app-footer">
        {dataSources.length > 0 && <span>Data: {dataSources.join(', ')}</span>}
        <span>
          Boundaries: NAMRIA, PSA via{' '}
          <a href="https://data.humdata.org/dataset/cod-ab-phl" target="_blank" rel="noopener noreferrer">
            HDX
          </a>{' '}
          (CC BY-IGO)
        </span>
        <span>Local mode: data stays in this browser</span>
      </footer>
    </div>
  );
}
