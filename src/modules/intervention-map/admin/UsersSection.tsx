// Who can use the map. Everything here goes through the admin-users Edge Function, which holds the
// project's secret key, and the database's rules still apply to what it does.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { InviteDelivery, PeopleApi, Person, PersonStatus } from '../data/store';
import type { UserRole } from '../data/types';
import { SelectField, TextField } from '../edit/FormParts';
import { copyText } from '../lib/copy-text';
import { manilaDate } from '../lib/dates';
import { ROLE_LABELS } from '../lib/permissions';
import { useStore } from '../state/store-context';
import { Feedback, useSaving } from './parts';

const STATUS_LABELS: Record<PersonStatus, string> = {
  active: 'Active',
  invited: 'Invited, hasn\'t set a password yet',
  deactivated: 'Deactivated',
  no_access: 'No role yet',
};

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((role) => ({ value: role, label: ROLE_LABELS[role] }));

function LinkBox({ link, onDismiss }: { link: string; onDismiss(): void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="conflict-note" role="status">
      <p>
        <strong>Send this link privately.</strong> It works once and expires, so treat it like a password.
      </p>
      <input className="admin-link" readOnly aria-label="Sign-in link" value={link} onFocus={(event) => event.target.select()} />
      <div className="form-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            void copyText(link).then(setCopied);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="secondary-button" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

function InviteForm({ people, onInvited }: { people: PeopleApi; onInvited(link: string | null, email: string): void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('encoder');
  const [delivery, setDelivery] = useState<InviteDelivery>('email');
  const { busy, failure, run } = useSaving();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let link: string | null = null;
    const done = await run(async () => {
      ({ link } = await people.invite({ email: email.trim(), full_name: fullName.trim(), role, delivery }));
    });
    if (done) {
      onInvited(link, email.trim());
      setEmail('');
      setFullName('');
    }
  };

  return (
    <form className="edit-form admin-form" onSubmit={(event) => void submit(event)} noValidate aria-label="Invite someone">
      <h3 className="section-title">Invite someone</h3>
      <div className="field-row">
        <TextField label="Email" type="email" required value={email} onChange={setEmail} />
        <TextField label="Full name" required value={fullName} onChange={setFullName} hint="It appears on what they encode." />
      </div>
      <SelectField label="Role" required value={role} options={ROLE_OPTIONS} onChange={(value) => setRole(value as UserRole)} />
      <fieldset>
        <legend className="section-title">How they get the invitation</legend>
        <label className="choice">
          <input type="radio" name="delivery" checked={delivery === 'email'} onChange={() => setDelivery('email')} />
          Email it to them
        </label>
        <label className="choice">
          <input type="radio" name="delivery" checked={delivery === 'link'} onChange={() => setDelivery('link')} />
          Give me a link to send them myself
        </label>
      </fieldset>
      <Feedback failure={failure} />
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </form>
  );
}

function PersonRow({ person, isMe, people, onChanged, onLink }: { person: Person; isMe: boolean; people: PeopleApi; onChanged(notice?: string): void; onLink(link: string): void }) {
  const { busy, failure, run } = useSaving();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(person.full_name ?? '');
  const shownName = person.full_name ?? person.email;

  const act = async (work: () => Promise<unknown>, notice?: string) => {
    if (await run(work)) onChanged(notice);
  };

  const newLink = (delivery: InviteDelivery) =>
    run(async () => {
      const { link } = await people.newLink(person.id, delivery);
      if (link) onLink(link);
      else onChanged(`A new link was emailed to ${person.email}.`);
    });

  const canSignIn = person.status === 'active' || person.status === 'invited';

  return (
    <li className={`admin-row admin-person${person.status === 'deactivated' ? ' admin-row-archived' : ''}`} data-row={person.email}>
      <span className="admin-row-main">
        {editingName ? (
          <form
            className="admin-name-form"
            aria-label={`Name of ${person.email}`}
            onSubmit={(event) => {
              event.preventDefault();
              void act(() => people.update(person.id, { full_name: name.trim() }), 'Saved the name.');
              setEditingName(false);
            }}
          >
            <input aria-label="Full name" value={name} onChange={(event) => setName(event.target.value)} />
            <button type="submit" className="secondary-button">
              Save
            </button>
            <button type="button" className="secondary-button" onClick={() => setEditingName(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <strong>
            {shownName}
            {isMe && ' (you)'}
          </strong>
        )}
        <span className="field-hint">{person.email}</span>
        <span className="field-hint">
          {STATUS_LABELS[person.status]}
          {person.last_sign_in_at && ` · Last signed in ${manilaDate(person.last_sign_in_at)}`}
        </span>
        {failure && (
          <span className="field-error" role="alert">
            {failure}
          </span>
        )}
      </span>
      <span className="admin-person-role">
        <label className="visually-hidden" htmlFor={`role-${person.id}`}>
          Role of {shownName}
        </label>
        <select
          id={`role-${person.id}`}
          value={person.role ?? ''}
          disabled={busy || isMe || person.status === 'deactivated'}
          onChange={(event) => void act(() => people.update(person.id, { role: event.target.value as UserRole }), `${shownName} is now ${ROLE_LABELS[event.target.value as UserRole]}.`)}
        >
          {person.role === null && <option value="">No role</option>}
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
      <span className="admin-row-actions">
        {!editingName && person.role !== null && (
          <button type="button" className="secondary-button" onClick={() => setEditingName(true)}>
            Edit name<span className="visually-hidden"> of {shownName}</span>
          </button>
        )}
        {canSignIn && (
          <>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void newLink('email')}>
              Email a new link<span className="visually-hidden"> to {shownName}</span>
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void newLink('link')}>
              Get a new link<span className="visually-hidden"> for {shownName}</span>
            </button>
          </>
        )}
        {!isMe && canSignIn && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Deactivate ${shownName}? They'll lose access at once. Their name stays on what they encoded.`)) {
                void act(() => people.deactivate(person.id), `${shownName} can no longer sign in.`);
              }
            }}
          >
            Deactivate<span className="visually-hidden"> {shownName}</span>
          </button>
        )}
        {person.status === 'deactivated' && (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => people.reactivate(person.id), `${shownName} has access again.`)}>
            Reactivate<span className="visually-hidden"> {shownName}</span>
          </button>
        )}
      </span>
    </li>
  );
}

export function UsersSection() {
  const { store } = useStore();
  const { people } = store;
  const [list, setList] = useState<Person[] | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!people) return;
    try {
      setList(await people.list());
      setLoadFailure(null);
    } catch (error) {
      setLoadFailure((error as Error).message);
    }
  }, [people]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!people) {
    return (
      <section className="admin-section" aria-label="Users">
        <h2>Users</h2>
        <p>Local mode has no accounts, so there's nobody to manage here. This page works on the real site.</p>
      </section>
    );
  }

  const changed = (message?: string) => {
    setNotice(message ?? null);
    void refresh();
  };

  return (
    <section className="admin-section" aria-label="Users">
      <header className="admin-section-header">
        <div>
          <h2>Users</h2>
          <p className="field-hint">Accounts are by invitation only. A role change applies the next time the person loads the map.</p>
        </div>
      </header>

      <Feedback failure={null} notice={notice} />
      {link && <LinkBox link={link} onDismiss={() => setLink(null)} />}

      <InviteForm
        people={people}
        onInvited={(newLink, email) => {
          if (newLink) setLink(newLink);
          changed(newLink ? `Added ${email}. Send them the link above.` : `Invited ${email}. They'll get an email with a link to set their password.`);
        }}
      />

      <h3 className="section-title">Everyone</h3>
      {loadFailure && (
        <div role="alert">
          <p className="field-error">{loadFailure}</p>
          <button type="button" className="secondary-button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}
      {!list && !loadFailure && <p>Loading…</p>}
      {list && (
        <ul className="admin-list" aria-label="Everyone">
          {[...list]
            .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email))
            .map((person) => (
              <PersonRow key={person.id} person={person} isMe={person.id === store.user.id} people={people} onChanged={changed} onLink={setLink} />
            ))}
        </ul>
      )}
    </section>
  );
}
