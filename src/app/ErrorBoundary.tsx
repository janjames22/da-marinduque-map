// Before Phase 17b an error while drawing a page left the whole screen blank. This catches it and
// says what happened, with a way on, and keeps the menu where it can.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isUpdateError } from '../modules/intervention-map/lib/error-message';

const RELOADED_AT = 'reloaded-for-update';
// One reload a minute at most, so a page whose code really is missing doesn't reload forever.
const RELOAD_GAP_MS = 60_000;

// A page's code that's gone, as when a new version was deployed while this tab was open, comes back
// with a reload. Returns false when this tab already tried that a moment ago.
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    // Storage may be blocked. Reloading once is still better than a broken page.
  }
  window.location.reload();
  return true;
}

interface Props {
  children: ReactNode;
  // A new value, such as the next page's address, clears the error.
  resetKey?: string;
  fallback(error: unknown, reset: () => void): ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('A page failed to draw', error, info.componentStack);
    if (isUpdateError(error)) reloadForUpdate();
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  reset = () => this.setState({ error: null });

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
