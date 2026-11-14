// The screen around signing in and setting a password: what the system is on one side, the form on
// the other. On a phone the two stack, form second.
import { Check, FileText, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { APP_NAME, OFFICE_LINE, OFFICE_NAME, OFFICE_SEAL } from '../brand';

const STEPS = [
  { Icon: MapPin, title: 'Mapped', note: 'Field or office' },
  { Icon: Check, title: 'Checked', note: 'QA queue' },
  { Icon: FileText, title: 'Reported', note: 'Reports and exports' },
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-intro" aria-label="About the Intervention Map">
        <div className="auth-brand">
          <span className="sidebar-logo has-seal">
            <img src={OFFICE_SEAL} alt="" />
          </span>
          <span className="sidebar-name">
            <strong>{APP_NAME}</strong>
            <span>{OFFICE_NAME}</span>
          </span>
        </div>
        <div className="auth-pitch">
          <h1>Every DA intervention in Marinduque, on one map.</h1>
          <ol className="auth-steps" aria-label="How records move">
            {STEPS.map(({ Icon, title, note }) => (
              <li key={title}>
                <span className="auth-step-icon">
                  <Icon aria-hidden="true" />
                </span>
                <strong>{title}</strong>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="auth-office">{OFFICE_LINE}</p>
      </section>
      <div className="auth-panel">{children}</div>
    </div>
  );
}
