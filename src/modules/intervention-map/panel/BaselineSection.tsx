import { useState, type FormEvent } from 'react';
import { CustomField } from '../edit/FormParts';
import { ConflictError, ValidationError } from '../data/store';
import type { Barangay, MapData } from '../data/types';
import { fieldValue } from '../lib/display';
import { attributesFromText, attributesToText } from '../lib/form-values';
import { activeFields, attributeKey, validateAttributes, type FieldErrors } from '../lib/validation';
import { useEditUi } from '../state/edit-ui';
import { useStore } from '../state/store-context';

export function BaselineSection({ barangay, data }: { barangay: Barangay; data: MapData }) {
  const { store } = useStore();
  const setNotice = useEditUi((state) => state.setNotice);
  const schema = data.barangayFields;
  const fields = activeFields(schema);

  const [entered, setEntered] = useState<Record<string, string> | null>(null);
  const [version, setVersion] = useState(barangay.version);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setEntered(attributesToText(schema, barangay.attributes));
    setVersion(barangay.version);
    setErrors({});
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!entered) return;
    const attributes = attributesFromText(schema, entered, barangay.attributes);
    const found = validateAttributes(schema, attributes);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setErrors({});
    setFailure(null);
    try {
      await store.updateBarangayBaseline(barangay.id, version, attributes, { kind: 'baseline' });
      setEntered(null);
      setNotice('Baseline saved.');
    } catch (error) {
      if (error instanceof ValidationError) {
        setErrors(error.fields);
      } else if (error instanceof ConflictError) {
        // What was typed here stays in the form, and saving again knowingly replaces their values.
        setFailure('Someone else just changed this baseline. Saving again will replace their values with the ones showing here.');
        setVersion((error.latest as Barangay | null)?.version ?? version);
      } else {
        setFailure(`Could not save: ${(error as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h3 className="section-title">Baseline</h3>
      {entered ? (
        <form className="edit-form" onSubmit={submit} noValidate aria-label="Edit baseline">
          {fields.map((field) => (
            <CustomField
              key={field.key}
              field={field}
              value={entered[field.key] ?? ''}
              error={errors[attributeKey(field.key)]}
              onChange={(value) => setEntered({ ...entered, [field.key]: value })}
            />
          ))}
          {failure && (
            <p className="field-error" role="alert">
              {failure}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={saving}>
              Save baseline
            </button>
            <button type="button" className="secondary-button" onClick={() => setEntered(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="baseline">
            {fields.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{fieldValue(field, barangay.attributes[field.key]) ?? 'Not set'}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="secondary-button" onClick={startEditing}>
            Edit baseline
          </button>
        </>
      )}
    </section>
  );
}
