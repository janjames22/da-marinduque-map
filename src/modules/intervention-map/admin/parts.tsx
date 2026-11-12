// What the admin screens share.
import { useCallback, useId, useState, type ReactNode } from 'react';
import { ConflictError, ValidationError } from '../data/store';
import type { Icon } from '../data/types';
import { ErrorText } from '../edit/FormParts';

export type Errors = Record<string, string>;

// A section of the Admin pages, as a card. On a page that has only this section, its title, help and
// button head the page instead, so the page doesn't say the same name twice.
export function SectionFrame({
  title,
  label = title,
  description,
  action,
  asPage = false,
  className = '',
  children,
}: {
  title: string;
  label?: string;
  description?: ReactNode;
  action?: ReactNode;
  asPage?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const heading = (
    <div>
      {asPage ? <h1>{title}</h1> : <h2>{title}</h2>}
      {description && <p>{description}</p>}
    </div>
  );
  return (
    <>
      {asPage && (
        <header className="page-header page-header-actions">
          {heading}
          {action}
        </header>
      )}
      <section className={`overview-card admin-section ${className}`.trim()} aria-label={label}>
        {!asPage && (
          <header className="admin-section-header">
            {heading}
            {action}
          </header>
        )}
        {children}
      </section>
    </>
  );
}

// One save at a time, with what happened to it. Rule breaks go to their fields.
export function useSaving() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  const run = useCallback(async (work: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    setErrors({});
    try {
      await work();
      if (success) setNotice(success);
      return true;
    } catch (error) {
      if (error instanceof ValidationError) {
        setErrors(error.fields);
        setFailure('Check the highlighted fields.');
      } else if (error instanceof ConflictError) {
        setFailure('Someone else saved a change to this first, so yours wasn\'t saved. Reload it to see theirs.');
      } else {
        setFailure((error as Error).message);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setFailure(null);
    setNotice(null);
    setErrors({});
  }, []);

  return { busy, failure, notice, errors, run, clear, setErrors, setFailure };
}

export function Feedback({ failure, notice }: { failure: string | null; notice?: string | null }) {
  return (
    <>
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}

export function ColorField({ label, value, onChange, error }: { label: string; value: string; onChange(value: string): void; error?: string }) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="color" className="color-input" value={value} onChange={(event) => onChange(event.target.value)} />
      <ErrorText id={`${id}-error`} message={error} />
    </div>
  );
}

// Through <img>, as on the map, so nothing inside an icon's file can run.
export const iconPreview = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

export function IconImage({ icon }: { icon: Icon | undefined }) {
  if (!icon) return <span className="admin-icon admin-icon-empty" aria-hidden="true" />;
  return <img className="admin-icon" src={iconPreview(icon.image)} alt="" />;
}

export function Swatch({ color }: { color: string }) {
  return <span className="admin-swatch" style={{ background: color }} aria-hidden="true" />;
}

export function MoveButtons({ name, onUp, onDown, disabled }: { name: string; onUp?(): void; onDown?(): void; disabled?: boolean }) {
  return (
    <span className="admin-move">
      <button type="button" className="icon-button" aria-label={`Move ${name} up`} disabled={disabled || !onUp} onClick={onUp}>
        ↑
      </button>
      <button type="button" className="icon-button" aria-label={`Move ${name} down`} disabled={disabled || !onDown} onClick={onDown}>
        ↓
      </button>
    </span>
  );
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Moves one row past its neighbour, and gives back the sort numbers that have to change.
export function reordered<T extends { id: number; sort_order: number }>(rows: T[], id: number, direction: -1 | 1): { id: number; sort_order: number }[] {
  const from = rows.findIndex((row) => row.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= rows.length) return [];
  const order = [...rows];
  [order[from], order[to]] = [order[to], order[from]];
  return order.flatMap((row, index) => (row.sort_order === index + 1 ? [] : [{ id: row.id, sort_order: index + 1 }]));
}
