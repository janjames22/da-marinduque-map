// The three states a whole page can be in before it shows its content, the same on every page:
// loading, could not load, and a message such as a page this account can't open.
import { CircleAlert, LockKeyhole, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeError } from '../lib/error-message';

// Shown only once the wait is long enough to notice (see .page-state.is-loading), so a quick page
// change doesn't flash it.
export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-state is-loading" role="status">
      <span className="page-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function PageMessage({ icon: Icon, title, tone = 'info', children, actions, alert = false }: { icon: LucideIcon; title: string; tone?: 'info' | 'error'; children?: ReactNode; actions?: ReactNode; alert?: boolean }) {
  return (
    <div className={`page-state is-${tone}`} role={alert ? 'alert' : undefined}>
      <span className="page-state-icon" aria-hidden="true">
        <Icon />
      </span>
      <h2>{title}</h2>
      {children}
      {actions && <div className="page-state-actions">{actions}</div>}
    </div>
  );
}

// What went wrong, in plain words, with a way to try again. The original message is under Details,
// for whoever helps.
export function PageError({ title = 'This page could not load', error, onRetry, children }: { title?: string; error: unknown; onRetry?: () => void; children?: ReactNode }) {
  const { problem, summary, details } = describeError(error);
  // A newer version or a sign-in that ran out only clears with a reload.
  const reload = problem === 'update' || problem === 'signed-out' || !onRetry;
  return (
    <PageMessage
      icon={problem === 'offline' ? WifiOff : CircleAlert}
      title={title}
      tone="error"
      alert
      actions={
        <button type="button" className="ui-button ui-button-primary" onClick={reload ? () => window.location.reload() : onRetry}>
          <RefreshCw aria-hidden="true" />
          {reload ? 'Reload the page' : 'Try again'}
        </button>
      }
    >
      <p>{summary}</p>
      {children}
      {details && details !== summary && (
        <details className="page-state-details">
          <summary>Details</summary>
          <p>{details}</p>
        </details>
      )}
    </PageMessage>
  );
}

export function PageNoAccess({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PageMessage icon={LockKeyhole} title={title} alert>
      <p>{children}</p>
    </PageMessage>
  );
}
