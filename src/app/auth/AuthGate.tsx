import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { authLink, getSupabase } from '../../modules/intervention-map/data/supabase-client';
import type { AppUser, UserRole } from '../../modules/intervention-map/data/types';
import { useEditUi } from '../../modules/intervention-map/state/edit-ui';
import { AuthLayout } from './AuthLayout';

const MIN_PASSWORD_LENGTH = 8;

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; notice?: string }
  | { status: 'set-password'; reason: 'invite' | 'recovery' | 'change'; user: AppUser | null }
  | { status: 'no-access'; email: string; deactivated: boolean }
  | { status: 'ready'; user: AppUser };

function linkProblem(): string | undefined {
  if (!authLink.error) return undefined;
  return 'That link has expired or was already used. Ask your Admin for a new one.';
}

function signInMessage(error: { message: string }): string {
  if (/invalid login credentials/i.test(error.message)) return 'Wrong email or password.';
  if (/banned/i.test(error.message)) return 'This account has been deactivated. Ask your Admin if you still need access.';
  if (/fetch|network/i.test(error.message)) return 'No connection. Check your internet and try again.';
  return error.message;
}

async function memberFor(userId: string) {
  const { data, error } = await getSupabase().from('profiles').select('id, full_name, role, deactivated_at').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; full_name: string | null; role: UserRole; deactivated_at: string | null } | null;
}

export interface SignedIn {
  user: AppUser;
  changePassword(): void;
  signOut(): void;
}

// Signs people in and decides what they see. Being signed in isn't enough: without an active
// profile, the database gives an account nothing, and this says so instead of showing an empty map.
export function AuthGate({ children }: { children(session: SignedIn): ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [failure, setFailure] = useState<string | null>(null);
  const status = useRef(state.status);
  status.current = state.status;

  const enter = useCallback(async (userId: string, email: string) => {
    try {
      const member = await memberFor(userId);
      if (!member || member.deactivated_at) {
        setState({ status: 'no-access', email, deactivated: Boolean(member?.deactivated_at) });
        return;
      }
      setFailure(null);
      setState((current) =>
        // A token refresh shouldn't rebuild the map and lose what's on screen.
        current.status === 'ready' && current.user.id === member.id && current.user.role === member.role
          ? current
          : { status: 'ready', user: { id: member.id, full_name: member.full_name, role: member.role } },
      );
    } catch (error) {
      setFailure(`Could not check your account: ${(error as Error).message}`);
    }
  }, []);

  useEffect(() => {
    const auth = getSupabase().auth;
    let cancelled = false;

    void auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (!session) {
        setState({ status: 'signed-out', notice: linkProblem() });
      } else if (authLink.type === 'invite' || authLink.type === 'recovery') {
        setState({ status: 'set-password', reason: authLink.type, user: null });
      } else {
        void enter(session.user.id, session.user.email ?? '');
      }
    });

    // Calling Supabase inside this callback can deadlock, so the work waits for it to return. The
    // first load is settled above: the events it also causes must not skip an invite's password
    // step or clear the note about an expired link. So SIGNED_IN only counts from the sign-in form.
    const { data } = auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (cancelled) return;
        if (event === 'SIGNED_OUT') setState({ status: 'signed-out' });
        else if (event === 'PASSWORD_RECOVERY') setState({ status: 'set-password', reason: 'recovery', user: null });
        else if (event === 'SIGNED_IN' && session && status.current === 'signed-out') void enter(session.user.id, session.user.email ?? '');
      }, 0);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [enter]);

  const signOut = useCallback(() => {
    useEditUi.getState().closePanel();
    void getSupabase().auth.signOut({ scope: 'local' });
  }, []);

  if (failure) {
    return (
      <AuthLayout>
        <div className="auth-card" role="alert">
          <h2>Could not open the map</h2>
          <p>{failure}</p>
          <button type="button" className="ui-button ui-button-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </AuthLayout>
    );
  }

  switch (state.status) {
    case 'loading':
      return <p className="page-message is-loading">Loading…</p>;
    case 'signed-out':
      return (
        <AuthLayout>
          <SignInForm notice={state.notice} />
        </AuthLayout>
      );
    case 'set-password':
      return (
        <AuthLayout>
          <SetPasswordForm
          reason={state.reason}
          onCancel={state.user ? () => setState({ status: 'ready', user: state.user! }) : undefined}
          onDone={async () => {
            const { data } = await getSupabase().auth.getUser();
            if (data.user) await enter(data.user.id, data.user.email ?? '');
          }}
          />
        </AuthLayout>
      );
    case 'no-access':
      return (
        <AuthLayout>
          <div className="auth-card" role="alert">
            <h2>{state.deactivated ? 'This account has been deactivated' : 'This account has no access yet'}</h2>
            <p>
              You're signed in as {state.email}, but it doesn't have a role on the map. Ask your Admin to {state.deactivated ? 'reactivate it' : 'add you'}.
            </p>
            <button type="button" className="ui-button ui-button-secondary" onClick={signOut}>
              Sign out
            </button>
          </div>
        </AuthLayout>
      );
    case 'ready':
      return children({
        user: state.user,
        signOut,
        changePassword: () => setState({ status: 'set-password', reason: 'change', user: state.user }),
      });
  }
}

function SignInForm({ notice }: { notice?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) setFailure(signInMessage(error));
    setBusy(false);
  };

  return (
    <form className="auth-card edit-form" onSubmit={submit} aria-label="Sign in">
      <h2>Sign in</h2>
      {notice && (
        <p className="field-error ui-notice ui-notice-danger" role="alert">
          {notice}
        </p>
      )}
      <div className="form-field">
        <label htmlFor="sign-in-email">Email</label>
        <input id="sign-in-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="sign-in-password">Password</label>
        <input
          id="sign-in-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {failure && (
        <p className="field-error ui-notice ui-notice-danger" role="alert">
          {failure}
        </p>
      )}
      <button type="submit" className="ui-button ui-button-primary" disabled={busy}>
        Sign in
      </button>
      <p className="field-hint">Accounts are by invitation. If you forgot your password or need access, ask your Admin.</p>
    </form>
  );
}

const PASSWORD_TITLES = {
  invite: 'Welcome. Choose a password',
  recovery: 'Choose a new password',
  change: 'Change your password',
};

function SetPasswordForm({ reason, onDone, onCancel }: { reason: keyof typeof PASSWORD_TITLES; onDone(): Promise<void>; onCancel?(): void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFailure(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== repeat) {
      setFailure('The two passwords don\'t match.');
      return;
    }
    setBusy(true);
    setFailure(null);
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) {
      setFailure(error.message);
      setBusy(false);
      return;
    }
    await onDone();
  };

  return (
    <form className="auth-card edit-form" onSubmit={submit} aria-label="Set password">
      <h2>{PASSWORD_TITLES[reason]}</h2>
      <div className="form-field">
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="field-hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
      </div>
      <div className="form-field">
        <label htmlFor="repeat-password">Repeat it</label>
        <input id="repeat-password" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </div>
      {failure && (
        <p className="field-error ui-notice ui-notice-danger" role="alert">
          {failure}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="ui-button ui-button-primary" disabled={busy}>
          Save password
        </button>
        {onCancel && (
          <button type="button" className="ui-button ui-button-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
