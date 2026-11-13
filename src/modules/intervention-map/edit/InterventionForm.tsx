import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ConflictError, ValidationError, type InterventionValues, type LinePositions } from '../data/store';
import type { AuditEntry, Intervention, InterventionType, MapData } from '../data/types';
import { auditChanges } from '../lib/audit-display';
import { recordsInView } from '../lib/choropleth';
import { isOnMap } from '../lib/display';
import {
  attributesToText,
  blankForm,
  buildPatch,
  defaultStatusId,
  formFromRecord,
  PENDING_PHOTO,
  statusChoices,
  valuesFromForm,
  valuesFromRecord,
  type FormState,
} from '../lib/form-values';
import { photoProblem } from '../lib/photo-meta';
import { editWarnings, linePartsOf, linePositionsOf, locatePoint, pointOf } from '../lib/qa';
import { activeFields, attributeKey, validateIntervention, validateStatus, type FieldErrors } from '../lib/validation';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { useStore } from '../state/store-context';
import { CustomField, PanelFrame, PhotoField, PlaceFields, SelectField, TextField, WarningList } from './FormParts';
import { LineLocation } from './LineLocation';
import { LocationInput } from './LocationInput';

interface InterventionFormProps {
  data: MapData;
  record: Intervention | null; // null means a new record
  prefill?: { municipality_id: number; barangay_id: number };
}

function activeLookup<T extends { id: number; name: string; is_active: boolean }>(items: T[], current: string) {
  return items.filter((item) => item.is_active || String(item.id) === current).map((item) => ({ value: item.id, label: item.name }));
}

export function InterventionForm({ data, record, prefill }: InterventionFormProps) {
  const { store, places } = useStore();
  const draft = useEditUi((state) => state.draft);
  const draftLine = useEditUi((state) => state.draftLine);
  const closePanel = useEditUi((state) => state.closePanel);
  const setDraft = useEditUi((state) => state.setDraft);
  const setNotice = useEditUi((state) => state.setNotice);
  const zoomToRecord = useMapUi((state) => state.zoomToRecord);

  const schemaFor = (id: number) => data.types.find((t) => t.id === id)?.field_schema ?? { fields: [] };

  const [form, setForm] = useState<FormState>(() =>
    record ? formFromRecord(record, schemaFor(record.intervention_type_id)) : blankForm(data, prefill),
  );
  const initialForm = useRef(form);
  const initialPoint = useRef(draft);
  const initialLine = useRef(draftLine);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<Record<string, File>>({});
  const [reason, setReason] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  // A long form can hide the problem off screen, especially on a phone.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  // The version this form started from, and the newest one the person has been told about.
  const [base, setBase] = useState(record);
  const [knownVersion, setKnownVersion] = useState(record?.version ?? 0);
  const latest = record ? (data.interventions.find((r) => r.id === record.id) ?? null) : null;
  const changedElsewhere = latest !== null && latest.version !== knownVersion;

  const typeId = Number(form.intervention_type_id);
  const type = data.types.find((t) => t.id === typeId) as InterventionType | undefined;
  // A road is a line, so a point placed on the map isn't its location: its line, drawn on the map, is.
  // A line in several parts can't be reshaped here, so it's left out and stays as it is.
  const isLine = type?.geometry_kind === 'line';
  const lineEditable = base?.geojson?.type !== 'MultiLineString';
  const linePositions = useMemo<LinePositions | null>(() => (draftLine ? draftLine.map(({ lat, lng }) => [lng, lat]) : null), [draftLine]);

  // A new record's place follows where it's put, until someone chooses a place themselves. A road's
  // follows its first point.
  const placeChosen = useRef(record !== null || prefill !== undefined);
  const placedAt = isLine ? (draftLine?.[0] ?? null) : draft;
  useEffect(() => {
    if (placeChosen.current || !placedAt) return;
    const id = locatePoint(placedAt, places);
    const barangay = data.barangays.find((b) => b.id === id);
    if (barangay) {
      setForm((current) => ({ ...current, municipality_id: String(barangay.municipality_id), barangay_id: String(barangay.id) }));
    }
  }, [placedAt?.lat, placedAt?.lng, places, data.barangays]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = type ? activeFields(type.field_schema) : [];
  const rule = (key: string) => type?.core_field_rules[key] ?? 'optional';

  const update = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));
  const textProps = (key: keyof FormState & string, label: string) => ({
    label,
    value: form[key] as string,
    onChange: (value: string) => update({ [key]: value }),
    error: errors[key],
    required: rule(key) === 'required',
  });

  const point = isLine ? null : draft;
  const lineValue = isLine && lineEditable ? linePositions : undefined;
  const values: InterventionValues | null = type ? { ...valuesFromForm(form, point, type.field_schema, base?.attributes, lineValue), field_photos: photoFiles } : null;

  const warnings = useMemo(() => {
    const municipalityId = Number(form.municipality_id);
    if (!municipalityId) return null;
    const barangayId = form.barangay_id === '' ? null : Number(form.barangay_id);
    return editWarnings(
      {
        id: record?.id ?? null,
        point,
        // The line as drawn so far, or as it is if it can't be reshaped here. One point isn't a line yet.
        ...(isLine ? { line: !lineEditable && base ? linePartsOf(base) : linePositions && linePositions.length >= 2 ? [linePositions] : null } : {}),
        municipality_id: municipalityId,
        barangay_id: barangayId,
        barangay_raw: latest?.barangay_raw ?? null,
        qa_flags: [],
        deleted_at: null,
        category_id: form.category_id === '' ? null : Number(form.category_id),
        beneficiary: form.beneficiary,
        year_funded: form.year_funded === '' ? null : Number(form.year_funded),
      },
      data.interventions,
      places,
      data,
    );
  }, [form, point, isLine, lineEditable, linePositions, base, data, places, record, latest]);

  const isDirty = () =>
    JSON.stringify(form) !== JSON.stringify(initialForm.current) ||
    JSON.stringify(draft) !== JSON.stringify(initialPoint.current) ||
    JSON.stringify(draftLine) !== JSON.stringify(initialLine.current);

  const close = () => {
    if (!isDirty() || window.confirm('Discard your changes?')) closePanel();
  };

  const finish = (saved: Intervention, message: string) => {
    closePanel();
    const ui = useMapUi.getState();
    const visible = recordsInView([saved], ui).length > 0 && !ui.hiddenTypeIds.includes(saved.intervention_type_id);
    if (isOnMap(saved) && visible) {
      setNotice(message);
      zoomToRecord(saved.id);
    } else if (!isOnMap(saved)) {
      setNotice(`${message} It isn't on the map because it has no usable coordinates.`);
    } else {
      setNotice(`${message} The current filters hide it on the map.`);
    }
  };

  // It can clear a flag and moves a record between barangays' counts, so it needs a reason, as
  // resolving a flag and moving a marker do.
  const barangayChanged = base !== null && form.barangay_id !== (base.barangay_id === null ? '' : String(base.barangay_id));

  const save = async (expectedVersion: number) => {
    if (!type || !values) return;
    const previous = base ? valuesFromRecord(base) : null;
    const found = validateIntervention(values, previous, { type, categories: data.categories, barangays: data.barangays });
    if (barangayChanged && reason.trim() === '') found.reason = 'Give a reason. It goes in the audit log.';
    if (!record) {
      Object.assign(
        found,
        validateStatus(
          { status_id: form.status_id === '' ? null : Number(form.status_id), status_date: form.status_date },
          typeId,
          data.typeStatuses,
        ),
      );
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFailure('Check the highlighted fields.');
      return;
    }

    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      if (record && base) {
        const patch = buildPatch(base, values, latest ?? base);
        if (Object.keys(patch).length === 0) {
          closePanel();
          setNotice('No changes to save.');
          return;
        }
        finish(await store.updateIntervention(record.id, expectedVersion, patch, barangayChanged ? { kind: 'edit', reason: reason.trim() } : { kind: 'edit' }), 'Saved.');
      } else {
        const saved = await store.createIntervention(
          values,
          { status_id: Number(form.status_id), status_date: form.status_date, remarks: form.status_remarks.trim() || null },
          { kind: 'create' },
        );
        finish(saved, 'Record added.');
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        setErrors(error.fields);
        setFailure('Check the highlighted fields.');
      } else if (error instanceof ConflictError) {
        setFailure('This record just changed. See the note above before saving.');
      } else {
        setFailure(`Could not save: ${(error as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(knownVersion);
  };

  const loadLatest = () => {
    if (!latest) return;
    const fresh = formFromRecord(latest, schemaFor(latest.intervention_type_id));
    setForm(fresh);
    initialForm.current = fresh;
    const point = pointOf(latest);
    setDraft(point);
    initialPoint.current = point;
    const line = linePositionsOf(latest)?.map(([lng, lat]) => ({ lat, lng })) ?? null;
    useEditUi.getState().setDraftLine(line);
    initialLine.current = line;
    setBase(latest);
    setKnownVersion(latest.version);
    setFailure(null);
    setErrors({});
  };

  const keepMine = () => {
    if (!latest) return;
    setKnownVersion(latest.version);
    void save(latest.version);
  };

  const conflictChanges =
    changedElsewhere && base && latest
      ? auditChanges(
          { old_row: base, new_row: latest } as unknown as AuditEntry,
          data,
          schemaFor(latest.intervention_type_id),
        )
      : [];

  const statusOptions = statusChoices(data, typeId);

  const categoryOptions = data.categories
    .filter((c) => c.intervention_type_id === typeId || c.intervention_type_id === null)
    .filter((c) => c.is_active || String(c.id) === form.category_id)
    .map((c) => ({ value: c.id, label: c.name }));

  const changeType = (value: string) => {
    const id = Number(value);
    // The category, custom fields and status list all belong to the type.
    update({
      intervention_type_id: value,
      category_id: '',
      attributes: attributesToText(schemaFor(id), {}),
      status_id: defaultStatusId(data, id),
    });
    setPhotoFiles({});
    setErrors({});

    // A point placed before choosing a road becomes the road's first point, and back again.
    const toLine = data.types.find((t) => t.id === id)?.geometry_kind === 'line';
    const edit = useEditUi.getState();
    if (toLine && !isLine) {
      const start = edit.draft;
      edit.setDraft(null);
      edit.setDraftLine(start ? [start] : null, start ? 'add' : null);
    } else if (!toLine && isLine) {
      const first = edit.draftLine?.[0] ?? null;
      edit.setDraftLine(null, null);
      edit.setDraft(first);
    }
  };

  const setPhoto = (key: string, file: File | null) => {
    const problem = file ? photoProblem(file) : null;
    if (problem) {
      setErrors((current) => ({ ...current, [attributeKey(key)]: problem }));
      return;
    }
    setErrors(({ [attributeKey(key)]: _cleared, ...others }) => others);
    setPhotoFiles(({ [key]: _replaced, ...others }) => (file ? { ...others, [key]: file } : others));
    update({ attributes: { ...form.attributes, [key]: file ? PENDING_PHOTO : '' } });
  };

  return (
    <PanelFrame title={record ? 'Edit record' : 'Add intervention'} onClose={close}>
      {changedElsewhere && latest && (
        <div className="conflict-note" role="alert">
          {latest.deleted_at ? (
            <p>
              <strong>This record was deleted</strong> while you were editing it. Restore it from Deleted records to change it.
            </p>
          ) : (
            <>
              <p>
                <strong>Someone else changed this record</strong> while you were editing it.
              </p>
              {conflictChanges.length > 0 && (
                <ul>
                  {conflictChanges.map((change) => (
                    <li key={change.field}>
                      {change.field}: now {change.to}
                    </li>
                  ))}
                </ul>
              )}
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={loadLatest}>
                  Load their version
                </button>
                <button type="button" className="secondary-button" onClick={keepMine}>
                  Save only the fields I changed
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <form ref={formRef} className="edit-form" onSubmit={submit} noValidate aria-label={record ? 'Edit record' : 'Add intervention'}>
        <SelectField
          label="Type"
          required
          value={form.intervention_type_id}
          disabled={record !== null}
          options={data.types.filter((t) => t.is_active || t.id === typeId).map((t) => ({ value: t.id, label: t.name }))}
          onChange={changeType}
        />
        {rule('category_id') !== 'hidden' && (
          <SelectField
            {...textProps('category_id', 'Category')}
            placeholder="Choose"
            options={categoryOptions}
          />
        )}
        {rule('title') !== 'hidden' && (
          <TextField {...textProps('title', 'Title')} hint="Optional if a category is chosen. The record is named after its category." />
        )}
        {rule('banner_program_id') !== 'hidden' && (
          <SelectField
            {...textProps('banner_program_id', 'Banner program')}
            placeholder="Choose"
            options={activeLookup(data.programs, form.banner_program_id)}
          />
        )}
        <div className="field-row">
          {rule('year_funded') !== 'hidden' && <TextField {...textProps('year_funded', 'Year funded')} type="number" />}
          {rule('quantity') !== 'hidden' && <TextField {...textProps('quantity', 'Quantity')} type="number" required />}
        </div>
        <div className="field-row">
          {rule('unit_cost') !== 'hidden' && <TextField {...textProps('unit_cost', 'Unit cost')} type="number" step="any" />}
          {rule('fund_source') !== 'hidden' && <TextField {...textProps('fund_source', 'Fund source')} />}
        </div>
        {rule('beneficiary') !== 'hidden' && <TextField {...textProps('beneficiary', 'Beneficiary')} />}
        {rule('beneficiary_type_id') !== 'hidden' && (
          <SelectField
            {...textProps('beneficiary_type_id', 'Beneficiary type')}
            placeholder="Not set"
            options={activeLookup(data.beneficiaryTypes, form.beneficiary_type_id)}
          />
        )}

        {isLine ? <LineLocation editable={lineEditable} error={errors.line} /> : <LocationInput />}

        <PlaceFields
          data={data}
          municipalityId={form.municipality_id}
          barangayId={form.barangay_id}
          errors={errors}
          onChange={(municipality_id, barangay_id) => {
            placeChosen.current = true;
            update({ municipality_id, barangay_id });
          }}
        />
        {barangayChanged && <TextField label="Reason for changing the barangay" required multiline value={reason} onChange={setReason} error={errors.reason} />}
        <SelectField
          label="Location basis"
          value={form.location_basis_id}
          placeholder="Not set"
          options={activeLookup(data.locationBases, form.location_basis_id)}
          onChange={(location_basis_id) => update({ location_basis_id })}
        />

        {warnings && (
          <WarningList
            result={warnings}
            onUsePlotted={(municipalityId, barangayId) => {
              placeChosen.current = true;
              update({ municipality_id: String(municipalityId), barangay_id: String(barangayId) });
            }}
          />
        )}

        {fields.map((field) =>
          field.input === 'photo' ? (
            <PhotoField
              key={field.key}
              field={field}
              value={form.attributes[field.key] ?? ''}
              fileName={photoFiles[field.key]?.name}
              error={errors[attributeKey(field.key)]}
              onChoose={(file) => setPhoto(field.key, file)}
              onClear={() => setPhoto(field.key, null)}
              onView={(photoId) => useEditUi.getState().showPhoto(photoId)}
            />
          ) : (
            <CustomField
              key={field.key}
              field={field}
              value={form.attributes[field.key] ?? ''}
              error={errors[attributeKey(field.key)]}
              onChange={(value) => update({ attributes: { ...form.attributes, [field.key]: value } })}
            />
          ),
        )}

        {rule('remarks') !== 'hidden' && <TextField {...textProps('remarks', 'Remarks')} multiline />}

        {!record && (
          <fieldset>
            <legend>Starting status</legend>
            <div className="field-row">
              <SelectField
                label="Status"
                required
                value={form.status_id}
                options={statusOptions}
                onChange={(status_id) => update({ status_id })}
                error={errors.status_id}
              />
              <TextField
                label="Status date"
                required
                type="date"
                value={form.status_date}
                onChange={(status_date) => update({ status_date })}
                error={errors.status_date}
              />
            </div>
          </fieldset>
        )}

        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={saving || (latest?.deleted_at ?? null) !== null}>
            {record ? 'Save changes' : 'Save record'}
          </button>
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </PanelFrame>
  );
}
