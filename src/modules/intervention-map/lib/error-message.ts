// Turns what went wrong into words for the person using the map. The browser's and the database's
// own messages ("Failed to fetch", "JWT expired") stay available as details, for whoever helps them.

export type Problem = 'offline' | 'signed-out' | 'update' | 'other';

export interface ErrorMessage {
  problem: Problem;
  // One plain sentence on what happened and what to do.
  summary: string;
  // The original message, when it says more than the summary.
  details: string | null;
}

// Chrome says "Failed to fetch", Firefox "NetworkError when attempting to fetch resource", Safari
// "Load failed". Supabase passes these on, sometimes after its own words.
const OFFLINE = /failed to fetch|networkerror|load failed|network request failed|err_internet_disconnected|err_network/i;
// A session that ran out, or a token the database no longer takes.
const SIGNED_OUT = /jwt expired|invalid jwt|refresh token|not authenticated|auth session missing/i;
// A page's code that's gone from the site, as after a new version is deployed while the page is open.
const UPDATE = /dynamically imported module|importing a module script failed|unable to preload css|chunkloaderror|loading chunk \S+ failed/i;

export function isUpdateError(error: unknown): boolean {
  return UPDATE.test(messageOf(error));
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '';
}

export function describeError(error: unknown): ErrorMessage {
  const message = messageOf(error).trim();
  // Chrome's words for a page's code that didn't come start "Failed to fetch" too, so they only mean
  // no connection when the browser says it's offline. Otherwise that code is most likely gone.
  const pageCode = UPDATE.test(message);
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (browserOffline || (!pageCode && OFFLINE.test(message))) {
    return { problem: 'offline', summary: 'No connection. Check your internet, then try again.', details: message || null };
  }
  if (pageCode) {
    return { problem: 'update', summary: 'A newer version of the map is out. Reload the page to get it.', details: message };
  }
  if (SIGNED_OUT.test(message)) {
    return { problem: 'signed-out', summary: 'Your sign-in has run out. Reload the page and sign in again.', details: message };
  }
  return {
    problem: 'other',
    summary: 'Something went wrong. Try again, and if it keeps happening, tell your Admin what you were doing.',
    details: message || null,
  };
}
