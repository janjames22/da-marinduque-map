// A dialog over the page, in the Phase 11 design: a card with a title, a round close button, a body that
// scrolls and a row of buttons at the bottom. On a phone it's a sheet that rises from the bottom, like the
// map's layers. Escape closes it, Tab stays inside it, and closing hands the focus back to where it was.
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string;
  // Read out with the close button, as in "Close export".
  closeLabel: string;
  onClose(): void;
  subtitle?: ReactNode;
  footer?: ReactNode;
  // A form gets the body and footer inside it, so the footer's button can submit it.
  onSubmit?(): void;
  formLabel?: string;
  children: ReactNode;
}

export function Dialog({ title, closeLabel, onClose, subtitle, footer, onSubmit, formLabel, children }: DialogProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (before?.isConnected) before.focus();
    };
  }, []);

  const inner = (
    <>
      <div className="ui-dialog-body">{children}</div>
      {footer && <div className="ui-dialog-footer">{footer}</div>}
    </>
  );

  return (
    <div className="ui-dialog-backdrop">
      <div ref={box} className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="ui-dialog-header">
          <span className="ui-dialog-handle" aria-hidden="true" />
          <div className="ui-dialog-heading">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" ref={closeButton} className="ui-dialog-close" onClick={onClose} aria-label={closeLabel}>
            <X aria-hidden="true" />
          </button>
        </header>
        {onSubmit ? (
          <form
            className="ui-dialog-form"
            aria-label={formLabel}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {inner}
          </form>
        ) : (
          inner
        )}
      </div>
    </div>
  );
}
