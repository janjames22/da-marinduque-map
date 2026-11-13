import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Bundled with the site, because its security policy only allows fonts from the site itself.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { PageError } from './modules/intervention-map/overview/PageState';
import './app/tokens.css';
import './app/app.css';
import './app/controls.css';
import './app/shell.css';
import './app/map.css';
import './app/map-phone.css';
import './app/touch.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The last resort, for an error outside any page, such as in the menu or the sign-in screens. */}
    <ErrorBoundary fallback={(error) => <PageError title="Something went wrong" error={error} />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
