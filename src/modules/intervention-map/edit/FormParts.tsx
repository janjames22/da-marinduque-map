import { useId, type ReactNode } from 'react';
import type { Barangay, FieldDefinition, MapData } from '../data/types';
import type { EditWarning, WarningResult } from '../lib/qa';

export function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="field-error">
      {message}
    </span>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string;
  required?: boolean;
  type?: 'text' | 'number' | 'date';
  unit?: string;
  multiline?: boolean;
  step?: string;
  hint?: ReactNode;
}

export function TextField({ label, value, onChange, error, required, type = 'text', unit, multiline, step, hint }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const shared = {
    id,
    value,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
  };
  return (
    <div className="form-field">
      <label htmlFor={id}>
        {label}
        {unit && <span className="field-unit"> ({unit})</span>}
        {required && <span className="required-mark"> *</span>}
      </label>
      {multiline ? (
        <textarea {...shared} rows={2} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...shared} type={type} step={step} onChange={(event) => onChange(event.target.value)} />
      )}
      {hint && <span className="field-hint">{hint}</span>}
      <ErrorText id={errorId} message={error} />
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  options: { value: string | number; label: string }[];
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export function SelectField({ label, value, onChange, options, placeholder, error, required, disabled }: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="form-field">
      <label htmlFor={id}>
        {label}
        {required && <span className="required-mark"> *</span>}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ErrorText id={errorId} message={error} />
    </div>
  );
}

// One input for a custom field, generated from the field's definition.
export function CustomField({ field, value, onChange, error }: { field: FieldDefinition; value: string; onChange(value: string): void; error?: string }) {
  switch (field.input) {
    case 'dropdown':
      return (
        <SelectField
          label={field.label}
          value={value}
          onChange={onChange}
          placeholder="Not set"
          // An archived option stays on the list only for a record that already has it.
          options={(field.options ?? []).filter((option) => !option.archived || option.value === value)}
          required={field.required}
          error={error}
        />
      );
    case 'yes_no':
      return (
        <SelectField
          label={field.label}
          value={value}
          onChange={onChange}
          placeholder="Not set"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          required={field.required}
          error={error}
        />
      );
    case 'photo':
      // No active type has a photo field yet. The form builder (Phase 5) adds them.
      return null;
    default:
      return (
        <TextField
          label={field.label}
          value={value}
          onChange={onChange}
          type={field.input === 'text' ? 'text' : field.input}
          step={field.input === 'number' ? 'any' : undefined}
          unit={field.unit}
          required={field.required}
          error={error}
        />
      );
  }
}

interface PlaceFieldsProps {
  data: Pick<MapData, 'municipalities' | 'barangays'>;
  municipalityId: string;
  barangayId: string;
  onChange(municipalityId: string, barangayId: string): void;
  errors?: Record<string, string>;
}

export function PlaceFields({ data, municipalityId, barangayId, onChange, errors }: PlaceFieldsProps) {
  const barangays: Barangay[] = data.barangays
    .filter((b) => b.municipality_id === Number(municipalityId))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="field-row">
      <SelectField
        label="Municipality"
        required
        value={municipalityId}
        placeholder="Choose"
        options={[...data.municipalities].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.id, label: m.name }))}
        // A barangay belongs to one municipality, so changing the municipality clears it.
        onChange={(value) => onChange(value, '')}
        error={errors?.municipality_id}
      />
      <SelectField
        label="Barangay"
        value={barangayId}
        placeholder={municipalityId === '' ? 'Choose a municipality first' : 'Not set'}
        disabled={municipalityId === ''}
        options={barangays.map((b) => ({ value: b.id, label: b.name }))}
        onChange={(value) => onChange(municipalityId, value)}
        error={errors?.barangay_id}
      />
    </div>
  );
}

interface WarningListProps {
  result: WarningResult;
  onUsePlotted?(municipalityId: number, barangayId: number): void;
}

const CAN_FIX: EditWarning['code'][] = ['muni_mismatch', 'barangay_mismatch', 'no_barangay', 'barangay_unmatched'];

export function WarningList({ result, onUsePlotted }: WarningListProps) {
  const { warnings, plotted } = result;
  const showFix = plotted && onUsePlotted && warnings.some((warning) => CAN_FIX.includes(warning.code));
  return (
    <div className="edit-warnings" role="status">
      {warnings.length > 0 && (
        <ul aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={warning.code} data-warning={warning.code}>
              {warning.message}
            </li>
          ))}
        </ul>
      )}
      {showFix && (
        <button type="button" className="secondary-button" onClick={() => onUsePlotted(plotted.municipalityId, plotted.barangayId)}>
          Set barangay to {plotted.label}
        </button>
      )}
    </div>
  );
}

export function PanelFrame({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose(): void; children: ReactNode }) {
  return (
    <aside className="panel panel-right" aria-label={title}>
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {children}
    </aside>
  );
}
