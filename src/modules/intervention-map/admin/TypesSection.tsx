// The type manager: what kinds of intervention exist, and the form each one gets.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TypeStatusValues, TypeValues } from '../data/store';
import type { CoreFieldRule, InterventionType, MapData } from '../data/types';
import { SelectField, TextField } from '../edit/FormParts';
import { CORE_FIELDS, draftProblems, draftsFromSchema, NEEDS_DRAWING, needsDrawing, newCode, schemaFromDrafts, validateTypeChange, type FieldDraft } from '../lib/admin-rules';
import { coreFieldLabel } from '../lib/validation';
import { useStore } from '../state/store-context';
import { FieldBuilder } from './FieldBuilder';
import { ColorField, Feedback, IconImage, MoveButtons, plural, reordered, Swatch, useSaving } from './parts';

// What a new type starts with, from the spec's list for the types that aren't in use yet.
const STARTING_STATUSES = ['Proposed', 'On-going', 'Completed', 'Operational', 'Needs Repair', 'Non-operational', 'Unknown'];
const OPERATIONAL_STATUS = 'Operational';

const GEOMETRY_LABELS: Record<InterventionType['geometry_kind'], string> = { point: 'Point', line: 'Line', polygon: 'Polygon' };

const recordsOfType = (data: MapData, typeId: number) => data.interventions.filter((record) => record.intervention_type_id === typeId);

export function TypesList({ data }: { data: MapData }) {
  const { store } = useStore();
  const { busy, failure, notice, run } = useSaving();

  const valuesOf = ({ code, name, geometry_kind, icon_id, color, core_field_rules, field_schema, sort_order, is_active }: InterventionType): TypeValues => ({
    code,
    name,
    geometry_kind,
    icon_id,
    color,
    core_field_rules,
    field_schema,
    sort_order,
    is_active,
  });
  const statusesOf = (typeId: number): TypeStatusValues[] =>
    data.typeStatuses
      .filter((entry) => entry.intervention_type_id === typeId)
      .map(({ status_id, is_default, counts_as_operational }) => ({ status_id, is_default, counts_as_operational }));

  const saveType = (type: InterventionType, changes: Partial<TypeValues>) => store.saveType(type.id, type.version, { ...valuesOf(type), ...changes }, statusesOf(type.id));

  const setActive = (type: InterventionType, is_active: boolean) => {
    const count = recordsOfType(data, type.id).length;
    if (!is_active && count > 0 && !window.confirm(`${type.name} has ${plural(count, 'record')}. They'll stay in the database, but leave the map until it's active again. Continue?`)) return;
    void run(() => saveType(type, { is_active }), `${type.name} is now ${is_active ? 'active, so its layer is on every map' : 'inactive'}.`);
  };

  const move = (type: InterventionType, direction: -1 | 1) =>
    run(async () => {
      for (const change of reordered(data.types, type.id, direction)) {
        const current = data.types.find((t) => t.id === change.id)!;
        await saveType(current, { sort_order: change.sort_order });
      }
    });

  return (
    <section className="admin-section" aria-label="Intervention types">
      <header className="admin-section-header">
        <div>
          <h2>Intervention types</h2>
          <p className="field-hint">Each active type is a layer on the map, with its own form and status list.</p>
        </div>
        <Link className="primary-button admin-add" to="/admin/types/new">
          + Add type
        </Link>
      </header>
      <Feedback failure={failure} notice={notice} />
      <ul className="admin-list">
        {data.types.map((type, index) => (
          <li key={type.id} className={`admin-row${type.is_active ? '' : ' admin-row-archived'}`} data-row={type.name}>
            <Swatch color={type.color} />
            <IconImage icon={data.icons.find((icon) => icon.id === type.icon_id)} />
            <span className="admin-row-main">
              <strong>{type.name}</strong>
              <span className="field-hint">
                {[
                  GEOMETRY_LABELS[type.geometry_kind],
                  plural(recordsOfType(data, type.id).length, 'record'),
                  type.is_active ? 'Active' : 'Inactive',
                  ...(needsDrawing(type.geometry_kind) ? [NEEDS_DRAWING] : []),
                ].join(' · ')}
              </span>
            </span>
            <span className="admin-row-actions">
              <MoveButtons
                name={type.name}
                disabled={busy}
                onUp={index > 0 ? () => void move(type, -1) : undefined}
                onDown={index < data.types.length - 1 ? () => void move(type, 1) : undefined}
              />
              <Link className="secondary-button" to={`/admin/types/${type.id}`}>
                Edit<span className="visually-hidden"> {type.name}</span>
              </Link>
              <button type="button" className="secondary-button" disabled={busy || (!type.is_active && needsDrawing(type.geometry_kind))} onClick={() => setActive(type, !type.is_active)}>
                {type.is_active ? 'Deactivate' : 'Activate'}
                <span className="visually-hidden"> {type.name}</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface EditorState {
  name: string;
  color: string;
  icon_id: string;
  geometry_kind: InterventionType['geometry_kind'];
  is_active: boolean;
  rules: Record<string, CoreFieldRule>;
  fields: FieldDraft[];
  statuses: TypeStatusValues[];
}

function startingState(type: InterventionType | undefined, data: MapData): EditorState {
  if (type) {
    return {
      name: type.name,
      color: type.color,
      icon_id: type.icon_id === null ? '' : String(type.icon_id),
      geometry_kind: type.geometry_kind,
      is_active: type.is_active,
      rules: { ...type.core_field_rules },
      fields: draftsFromSchema(type.field_schema),
      statuses: data.typeStatuses
        .filter((entry) => entry.intervention_type_id === type.id)
        .map(({ status_id, is_default, counts_as_operational }) => ({ status_id, is_default, counts_as_operational })),
    };
  }
  const starting = STARTING_STATUSES.flatMap((name) => {
    const status = data.statuses.find((s) => s.name === name && s.is_active);
    return status ? [{ status_id: status.id, is_default: false, counts_as_operational: name === OPERATIONAL_STATUS }] : [];
  });
  if (starting[0]) starting[0].is_default = true;
  return { name: '', color: '#2e7d32', icon_id: '', geometry_kind: 'point', is_active: true, rules: {}, fields: [], statuses: starting };
}

// A different type in the address gets a fresh form.
export function TypeEditorRoute({ data }: { data: MapData }) {
  const { id = '' } = useParams();
  return <TypeEditor key={id} id={id} data={data} />;
}

function TypeEditor({ id, data }: { id: string; data: MapData }) {
  const isNew = id === 'new';
  const typeId = isNew ? null : Number(id);
  const type = data.types.find((t) => t.id === typeId);
  const { store } = useStore();
  const navigate = useNavigate();
  const { busy, failure, errors, run, setErrors, setFailure } = useSaving();

  const [form, setForm] = useState<EditorState>(() => startingState(type, data));
  const [version, setVersion] = useState(type?.version ?? null);
  const [problems, setProblems] = useState<Record<string, string>>({});

  if (!isNew && !type) {
    return (
      <section className="admin-section">
        <h2>That type wasn't found</h2>
        <Link to="/admin/types">Back to the types</Link>
      </section>
    );
  }

  const update = (changes: Partial<EditorState>) => setForm((current) => ({ ...current, ...changes }));
  const hasRecords = type ? recordsOfType(data, type.id).length > 0 : false;
  const changedElsewhere = type !== undefined && version !== null && type.version > version;
  // Going back to Point gives the switch back as it was.
  const waitingForDrawing = needsDrawing(form.geometry_kind);

  const reload = () => {
    setForm(startingState(type, data));
    setVersion(type?.version ?? null);
    setProblems({});
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = draftProblems(form.fields);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setFailure('Check the fields marked below.');
      return;
    }

    const values: TypeValues = {
      code: type?.code ?? newCode(form.name, data.types.map((t) => t.code)),
      name: form.name.trim(),
      geometry_kind: form.geometry_kind,
      icon_id: form.icon_id === '' ? null : Number(form.icon_id),
      color: form.color,
      core_field_rules: form.rules,
      field_schema: schemaFromDrafts(form.fields),
      sort_order: type?.sort_order ?? data.types.length + 1,
      is_active: form.is_active && !waitingForDrawing,
    };

    const invalid = validateTypeChange(typeId, values, form.statuses, data);
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      setFailure('Check the highlighted fields.');
      return;
    }

    const saved = await run(() => store.saveType(typeId, version, values, form.statuses));
    if (saved) navigate('/admin/types');
  };

  const available = data.statuses.filter((status) => status.is_active && !form.statuses.some((entry) => entry.status_id === status.id));
  const setStatus = (statusId: number, changes: Partial<TypeStatusValues>) =>
    update({ statuses: form.statuses.map((entry) => (entry.status_id === statusId ? { ...entry, ...changes } : entry)) });
  const moveStatus = (index: number, direction: -1 | 1) => {
    const order = [...form.statuses];
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    update({ statuses: order });
  };
  const removeStatus = (statusId: number) => {
    const rest = form.statuses.filter((entry) => entry.status_id !== statusId);
    // There's always one default, so taking away the default passes it on.
    if (rest.length > 0 && !rest.some((entry) => entry.is_default)) rest[0] = { ...rest[0], is_default: true };
    update({ statuses: rest });
  };

  const categories = data.categories.filter((category) => category.intervention_type_id === type?.id && category.is_active);

  return (
    <section className="admin-section" aria-label={isNew ? 'Add type' : `Edit ${type?.name}`}>
      <header className="admin-section-header">
        <div>
          <h2>{isNew ? 'Add a type' : `Edit ${type?.name}`}</h2>
          {type && <p className="field-hint">Code: {type.code}. It stays the same even if the name changes.</p>}
        </div>
        <Link className="secondary-button" to="/admin/types">
          Back to the types
        </Link>
      </header>

      {changedElsewhere && (
        <div className="conflict-note" role="alert">
          <p>
            <strong>Someone else saved a change to this type</strong> while you were editing it.
          </p>
          <button type="button" className="secondary-button" onClick={reload}>
            Load their version
          </button>
        </div>
      )}

      <form className="edit-form admin-form" onSubmit={(event) => void submit(event)} noValidate aria-label="Type">
        <TextField label="Name" required value={form.name} onChange={(name) => update({ name })} error={errors.name} />
        <div className="field-row">
          <ColorField label="Color" value={form.color} onChange={(color) => update({ color })} error={errors.color} />
          <SelectField
            label="Icon"
            value={form.icon_id}
            placeholder="No icon"
            options={data.icons.filter((icon) => icon.is_active || String(icon.id) === form.icon_id).map((icon) => ({ value: icon.id, label: icon.name }))}
            onChange={(icon_id) => update({ icon_id })}
          />
        </div>
        <SelectField
          label="Geometry"
          value={form.geometry_kind}
          disabled={hasRecords}
          options={(Object.keys(GEOMETRY_LABELS) as InterventionType['geometry_kind'][]).map((kind) => ({ value: kind, label: GEOMETRY_LABELS[kind] }))}
          onChange={(geometry_kind) => update({ geometry_kind: geometry_kind as InterventionType['geometry_kind'] })}
          error={errors.geometry_kind}
        />
        {hasRecords && <p className="field-hint">This type has records, so its geometry can't change.</p>}
        <label className="choice">
          <input
            type="checkbox"
            checked={form.is_active && !waitingForDrawing}
            disabled={waitingForDrawing}
            aria-describedby={waitingForDrawing ? 'needs-drawing' : undefined}
            onChange={(event) => update({ is_active: event.target.checked })}
          />
          Active: show this type as a layer, and offer it when adding a record
        </label>
        {waitingForDrawing && (
          <p className="field-hint" id="needs-drawing">
            {NEEDS_DRAWING}
          </p>
        )}

        <fieldset>
          <legend className="section-title">Standard fields</legend>
          <p className="field-hint">Whether each one is required, optional or hidden on this type's form.</p>
          {errors.core_field_rules && <p className="field-error" role="alert">{errors.core_field_rules}</p>}
          <div className="admin-rules">
            {CORE_FIELDS.map((key) => (
              <SelectField
                key={key}
                label={key === 'quantity' ? 'Quantity' : coreFieldLabel(key)}
                value={form.rules[key] ?? 'optional'}
                options={[
                  { value: 'required', label: 'Required' },
                  { value: 'optional', label: 'Optional' },
                  { value: 'hidden', label: 'Hidden' },
                ]}
                onChange={(rule) => update({ rules: { ...form.rules, [key]: rule as CoreFieldRule } })}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="section-title">Status list</legend>
          <p className="field-hint">The statuses this type's records can have, in order. "Operational" decides what counts in the dashboard's % operational.</p>
          {errors.statuses && <p className="field-error" role="alert">{errors.statuses}</p>}
          <ul className="admin-list" aria-label="Status list">
            {form.statuses.map((entry, index) => {
              const status = data.statuses.find((s) => s.id === entry.status_id);
              const name = status?.name ?? 'Unknown';
              return (
                <li key={entry.status_id} className="admin-row" data-row={name}>
                  {status && <Swatch color={status.color} />}
                  <span className="admin-row-main">
                    <strong>{name}</strong>
                    {status && !status.is_active && <span className="field-hint">Archived</span>}
                  </span>
                  <label className="choice">
                    <input
                      type="radio"
                      name="default-status"
                      checked={entry.is_default}
                      onChange={() => update({ statuses: form.statuses.map((other) => ({ ...other, is_default: other.status_id === entry.status_id })) })}
                    />
                    Default<span className="visually-hidden"> status: {name}</span>
                  </label>
                  <label className="choice">
                    <input type="checkbox" checked={entry.counts_as_operational} onChange={(event) => setStatus(entry.status_id, { counts_as_operational: event.target.checked })} />
                    Operational<span className="visually-hidden">: {name}</span>
                  </label>
                  <span className="admin-row-actions">
                    <MoveButtons
                      name={name}
                      onUp={index > 0 ? () => moveStatus(index, -1) : undefined}
                      onDown={index < form.statuses.length - 1 ? () => moveStatus(index, 1) : undefined}
                    />
                    <button type="button" className="secondary-button" onClick={() => removeStatus(entry.status_id)}>
                      Remove<span className="visually-hidden"> {name}</span>
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {available.length > 0 && (
            <SelectField
              label="Add a status"
              value=""
              placeholder="Choose"
              options={available.map((status) => ({ value: status.id, label: status.name }))}
              onChange={(value) => {
                if (value === '') return;
                update({ statuses: [...form.statuses, { status_id: Number(value), is_default: form.statuses.length === 0, counts_as_operational: false }] });
              }}
            />
          )}
          <p className="field-hint">
            New status names are made on the <Link to="/admin/statuses">Statuses</Link> page.
          </p>
        </fieldset>

        <fieldset>
          <legend className="section-title">Custom fields</legend>
          <p className="field-hint">
            Extra fields on this type's form. Categories are on the <Link to="/admin/categories">Categories</Link> page{type ? ` (${categories.length} for this type)` : ''}.
          </p>
          {errors.field_schema && <p className="field-error" role="alert">{errors.field_schema}</p>}
          <FieldBuilder fields={form.fields} onChange={(fields) => update({ fields })} allowPhoto problems={problems} />
        </fieldset>

        <Feedback failure={failure} />
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy || changedElsewhere}>
            Save type
          </button>
          <Link className="secondary-button" to="/admin/types">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
