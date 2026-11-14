// The demo site's sign-in screen: the usual form, and below it the demo accounts, one per role, each
// with a Use button that fills the form in. Only built into the demo site (App.tsx).
import { Eye, EyeOff } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { AppUser } from '../../modules/intervention-map/data/types';
import { AuthLayout } from './AuthLayout';
import { DEMO_ACCOUNTS, demoUser, findDemoAccount, savedDemoAccount, saveDemoAccount, type DemoAccount } from './demo-accounts';

function DemoSignIn({ onSignIn }: { onSignIn(account: DemoAccount): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const account = findDemoAccount(email, password);
    if (account) onSignIn(account);
    else setFailure('Wrong email or password.');
  };

  const use = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setFailure(null);
    document.getElementById('sign-in-email')?.focus();
  };

  return (
    <AuthLayout>
      <div className="demo-sign-in">
        <form className="auth-card edit-form" onSubmit={submit} aria-label="Sign in">
          <h2>Sign in</h2>
          <div className="form-field">
            <label htmlFor="sign-in-email">Email</label>
            <input id="sign-in-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="sign-in-password">Password</label>
            <input
              id="sign-in-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {failure && (
            <p className="field-error ui-notice ui-notice-danger" role="alert">
              {failure}
            </p>
          )}
          <button type="submit" className="ui-button ui-button-primary">
            Sign in
          </button>
        </form>

        <section className="demo-accounts" aria-labelledby="demo-accounts-title">
          <header className="demo-accounts-header">
            <div>
              <h2 id="demo-accounts-title">Demo accounts</h2>
              <p>One per role. All names here are made up, and what you change stays in this browser.</p>
            </div>
            <button type="button" className="ui-button ui-button-secondary ui-button-small" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>
              {hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              {hidden ? 'Show all' : 'Hide all'}
            </button>
          </header>
          {!hidden && (
            <ul className="demo-account-list">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.role} className="demo-account">
                  <div>
                    <strong>{account.label}</strong>
                    <span className="demo-account-note">{account.note}</span>
                    <span>{account.email}</span>
                    <code>{account.password}</code>
                  </div>
                  <button type="button" className="ui-button ui-button-secondary ui-button-small" aria-label={`Use the ${account.label} account`} onClick={() => use(account)}>
                    Use
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AuthLayout>
  );
}

// Signs a demo visitor in and out. The account is remembered for this tab.
export function DemoGate({ children }: { children(session: { user: AppUser; signOut(): void }): ReactNode }) {
  const [account, setAccount] = useState<DemoAccount | null>(() => savedDemoAccount());
  const user = useMemo(() => (account ? demoUser(account) : null), [account]);

  if (!account || !user) {
    return (
      <DemoSignIn
        onSignIn={(chosen) => {
          saveDemoAccount(chosen);
          setAccount(chosen);
        }}
      />
    );
  }
  return children({
    user,
    signOut: () => {
      saveDemoAccount(null);
      setAccount(null);
    },
  });
}
