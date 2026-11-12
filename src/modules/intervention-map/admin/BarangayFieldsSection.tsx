// The barangay baseline form: the same builder as a type's, without photo fields, as photos belong to
// a record.
import { useState, type FormEvent } from 'react';
import type { MapData } from '../data/types';
import { draftProblems, draftsFromSchema, schemaFromDrafts, type FieldDraft } from '../lib/admin-rules';
import { useStore } from '../state/store-context';
import { FieldBuilder } from './FieldBuilder';
import { Feedback, SectionFrame, useSaving } from './parts';

export function BarangayFieldsSection({ data }: { data: MapData }) {
  const { store } = useStore();
  const { busy, failure, notice, errors, run, setFailure } = useSaving();
  const [fields, setFields] = useState<FieldDraft[]>(() => draftsFromSchema(data.barangayFields));
  const [version, setVersion] = useState(data.barangayFieldsVersion);
  const [problems, setProblems] = useState<Record<string, string>>({});

  // Only a newer version: after a save, this screen is ahead of the data until the reload lands.
  const changedElsewhere = data.barangayFieldsVersion > version;

  const reload = () => {
    setFields(draftsFromSchema(data.barangayFields));
    setVersion(data.barangayFieldsVersion);
    setProblems({});
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = draftProblems(fields);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setFailure('Check the fields marked below.');
      return;
    }
    const schema = schemaFromDrafts(fields);
    const done = await run(() => store.saveBarangayFields(version, schema), 'Saved the barangay fields.');
    if (done) {
      // New fields now have their keys for good, so the next save must build on those.
      setFields(draftsFromSchema(schema));
      setVersion(version + 1);
    }
  };

  return (
    <SectionFrame title="Barangay fields" description="The baseline values Encoders can fill in on each barangay's profile.">
      {changedElsewhere && (
        <div className="conflict-note" role="alert">
          <p>
            <strong>Someone else saved a change to these fields</strong> while you were editing them.
          </p>
          <button type="button" className="secondary-button" onClick={reload}>
            Load their version
          </button>
        </div>
      )}
      <form className="edit-form admin-form" onSubmit={(event) => void submit(event)} noValidate aria-label="Barangay fields">
        <FieldBuilder fields={fields} onChange={setFields} allowPhoto={false} problems={problems} />
        {errors.field_schema && <p className="field-error" role="alert">{errors.field_schema}</p>}
        <Feedback failure={failure} notice={notice} />
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy || changedElsewhere}>
            Save barangay fields
          </button>
        </div>
      </form>
    </SectionFrame>
  );
}
