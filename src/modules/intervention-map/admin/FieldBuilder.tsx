// The form builder, for a type's custom fields and for the barangay baseline. A saved field keeps its
// key and kind for good, so its values keep their meaning. Taking one away archives it.
import { useId } from 'react';
import type { FieldDefinition } from '../data/types';
import { newDraftId, type FieldDraft, type OptionDraft } from '../lib/admin-rules';
import { MoveButtons } from './parts';

const KINDS: { value: FieldDefinition['input']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'yes_no', label: 'Yes or no' },
  { value: 'photo', label: 'Photo' },
];

interface FieldBuilderProps {
  fields: FieldDraft[];
  onChange(fields: FieldDraft[]): void;
  allowPhoto: boolean;
  problems: Record<string, string>;
}

function FieldRow({
  field,
  allowPhoto,
  problem,
  onChange,
  onRemove,
  onUp,
  onDown,
}: {
  field: FieldDraft;
  allowPhoto: boolean;
  problem?: string;
  onChange(changes: Partial<FieldDraft>): void;
  onRemove(): void;
  onUp?(): void;
  onDown?(): void;
}) {
  const id = useId();
  const saved = field.key !== '';
  const name = field.label.trim() || 'new field';
  const options = field.options ?? [];

  const setOption = (draftId: string, changes: Partial<OptionDraft>) =>
    onChange({ options: options.map((option) => (option.draftId === draftId ? { ...option, ...changes } : option)) });

  return (
    <fieldset className={`admin-field${field.archived ? ' admin-field-archived' : ''}`} aria-label={`Field: ${name}`}>
      <div className="admin-field-grid">
        <div className="form-field">
          <label htmlFor={`${id}-label`}>Label</label>
          <input id={`${id}-label`} value={field.label} disabled={field.archived} aria-invalid={problem ? true : undefined} onChange={(event) => onChange({ label: event.target.value })} />
        </div>
        <div className="form-field">
          <label htmlFor={`${id}-kind`}>Kind</label>
          <select
            id={`${id}-kind`}
            value={field.input}
            disabled={saved}
            onChange={(event) => {
              const input = event.target.value as FieldDefinition['input'];
              onChange({ input, options: input === 'dropdown' ? (field.options ?? [{ draftId: newDraftId(), value: '', label: '' }]) : undefined });
            }}
          >
            {KINDS.filter((kind) => allowPhoto || kind.value !== 'photo' || field.input === 'photo').map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          {saved && <span className="field-hint">A saved field keeps its kind.</span>}
        </div>
        {field.input === 'number' && (
          <div className="form-field">
            <label htmlFor={`${id}-unit`}>Unit</label>
            <input id={`${id}-unit`} value={field.unit ?? ''} placeholder="ha, kW, no." disabled={field.archived} onChange={(event) => onChange({ unit: event.target.value })} />
          </div>
        )}
      </div>

      {field.input === 'dropdown' && (
        <div className="admin-options">
          <span className="field-label">Options</span>
          {options.map((option, index) => (
            <div key={option.draftId} className={`admin-option${option.archived ? ' admin-field-archived' : ''}`}>
              <input aria-label={`Option ${index + 1} of ${name}`} value={option.label} disabled={field.archived || option.archived} onChange={(event) => setOption(option.draftId, { label: event.target.value })} />
              {option.value === '' ? (
                <button type="button" className="link-button" onClick={() => onChange({ options: options.filter((o) => o.draftId !== option.draftId) })}>
                  Remove
                </button>
              ) : (
                <button type="button" className="link-button" onClick={() => setOption(option.draftId, { archived: !option.archived })}>
                  {option.archived ? 'Restore' : 'Archive'}
                </button>
              )}
            </div>
          ))}
          <button type="button" className="link-button" disabled={field.archived} onClick={() => onChange({ options: [...options, { draftId: newDraftId(), value: '', label: '' }] })}>
            + Add an option
          </button>
        </div>
      )}

      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}

      <div className="admin-field-actions">
        <label className="choice">
          <input type="checkbox" checked={Boolean(field.required)} disabled={field.archived} onChange={(event) => onChange({ required: event.target.checked })} />
          Required
        </label>
        {field.archived && <span className="field-hint">Archived. Hidden from the form. Existing values are kept.</span>}
        <span className="admin-row-actions">
          {!field.archived && <MoveButtons name={name} onUp={onUp} onDown={onDown} />}
          {saved ? (
            <button type="button" className="secondary-button" onClick={() => onChange({ archived: !field.archived })}>
              {field.archived ? 'Restore' : 'Archive'}
              <span className="visually-hidden"> {name}</span>
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={onRemove}>
              Remove<span className="visually-hidden"> {name}</span>
            </button>
          )}
        </span>
      </div>
    </fieldset>
  );
}

export function FieldBuilder({ fields, onChange, allowPhoto, problems }: FieldBuilderProps) {
  const replace = (draftId: string, changes: Partial<FieldDraft>) => onChange(fields.map((field) => (field.draftId === draftId ? { ...field, ...changes } : field)));

  const live = fields.filter((field) => !field.archived);
  // Archived fields stay in the list, so their keys stay taken, and sit after the live ones.
  const move = (draftId: string, direction: -1 | 1) => {
    const order = [...live];
    const from = order.findIndex((field) => field.draftId === draftId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    onChange([...order, ...fields.filter((field) => field.archived)]);
  };

  const shown = [...live, ...fields.filter((field) => field.archived)];

  return (
    <div className="admin-fields">
      {shown.length === 0 && <p className="field-hint">No custom fields yet.</p>}
      {shown.map((field) => {
        const place = live.indexOf(field);
        return (
          <FieldRow
            key={field.draftId}
            field={field}
            allowPhoto={allowPhoto}
            problem={problems[field.draftId]}
            onChange={(changes) => replace(field.draftId, changes)}
            onRemove={() => onChange(fields.filter((f) => f.draftId !== field.draftId))}
            onUp={place > 0 ? () => move(field.draftId, -1) : undefined}
            onDown={place !== -1 && place < live.length - 1 ? () => move(field.draftId, 1) : undefined}
          />
        );
      })}
      <button type="button" className="secondary-button" onClick={() => onChange([...fields, { draftId: newDraftId(), key: '', label: '', input: 'text' }])}>
        + Add a field
      </button>
    </div>
  );
}
