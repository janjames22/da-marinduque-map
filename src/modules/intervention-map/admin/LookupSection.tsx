// One editable list: programs, categories, statuses, report signatures and the rest. Rows are archived,
// never deleted, so existing records keep their meaning.
import { useMemo, useState, type FormEvent } from 'react';
import type { LookupTable, LookupValues } from '../data/store';
import type { Icon, MapData } from '../data/types';
import { SelectField, TextField } from '../edit/FormParts';
import { iconProblem, newCode } from '../lib/admin-rules';
import { useStore } from '../state/store-context';
import { ColorField, Feedback, iconPreview, IconImage, MoveButtons, plural, reordered, SectionFrame, Swatch, useSaving } from './parts';

export interface LookupRow {
  id: number;
  name: string;
  code?: string;
  color?: string;
  image?: string;
  icon_id?: number | null;
  intervention_type_id?: number | null;
  category_group_id?: number | null;
  sort_order?: number;
  is_active?: boolean;
  counts_as_assessed?: boolean;
  label?: string;
  position?: string;
}

// label and position are a signature block's words above and below the name.
type LookupField = 'color' | 'icon' | 'type' | 'group' | 'image' | 'assessed' | 'label' | 'position';

interface LookupSectionProps {
  title: string;
  singular: string;
  description: string;
  table: LookupTable;
  rows: LookupRow[];
  fields?: LookupField[];
  data: MapData;
  usage?(row: LookupRow): number;
  usageWord?: string;
  hasCode?: boolean;
  canArchive?: boolean;
  canReorder?: boolean;
  defaultColor?: string;
  // The only list on its page, so its title heads the page.
  asPage?: boolean;
}

interface FormValues {
  name: string;
  color: string;
  image: string;
  icon_id: string;
  intervention_type_id: string;
  category_group_id: string;
  counts_as_assessed: boolean;
  label: string;
  position: string;
}

const optionalId = (value: string) => (value === '' ? null : Number(value));
const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

function LookupForm({
  title,
  row,
  fields,
  data,
  defaultColor,
  busy,
  errors,
  onSave,
  onCancel,
}: {
  title: string;
  row: LookupRow | null;
  fields: LookupField[];
  data: MapData;
  defaultColor: string;
  busy: boolean;
  errors: Record<string, string>;
  onSave(values: FormValues): void;
  onCancel(): void;
}) {
  const [values, setValues] = useState<FormValues>({
    name: row?.name ?? '',
    color: row?.color ?? defaultColor,
    image: row?.image ?? '',
    icon_id: text(row?.icon_id),
    intervention_type_id: text(row?.intervention_type_id),
    category_group_id: text(row?.category_group_id),
    counts_as_assessed: row?.counts_as_assessed ?? true,
    label: row?.label ?? '',
    position: row?.position ?? '',
  });
  const update = (changes: Partial<FormValues>) => setValues((current) => ({ ...current, ...changes }));
  const has = (field: LookupField) => fields.includes(field);
  const [fileProblem, setFileProblem] = useState<string | null>(null);

  const readIconFile = async (file: File | undefined) => {
    if (!file) return;
    setFileProblem(null);
    const svg = (await file.text()).trim();
    const problem = iconProblem(svg);
    if (problem) setFileProblem(problem);
    else update({ image: svg, name: values.name || file.name.replace(/\.svg$/i, '') });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(values);
  };

  const iconOptions = data.icons.filter((icon) => icon.is_active || String(icon.id) === values.icon_id).map((icon) => ({ value: icon.id, label: icon.name }));

  return (
    <form className="edit-form admin-form" onSubmit={submit} noValidate aria-label={title}>
      {has('label') && (
        <TextField label="Label" required value={values.label} onChange={(label) => update({ label })} error={errors.label} hint='Printed above the name, such as "Prepared by" or "Noted by".' />
      )}
      <TextField label="Name" required value={values.name} onChange={(name) => update({ name })} error={errors.name} />
      {has('position') && (
        <TextField label="Position (optional)" value={values.position} onChange={(position) => update({ position })} error={errors.position} hint="Printed under the name." />
      )}
      {has('type') && (
        <SelectField
          label="Intervention type"
          value={values.intervention_type_id}
          placeholder="Any type"
          options={data.types.map((type) => ({ value: type.id, label: type.is_active ? type.name : `${type.name} (inactive)` }))}
          onChange={(intervention_type_id) => update({ intervention_type_id })}
        />
      )}
      {has('group') && (
        <SelectField
          label="Group"
          value={values.category_group_id}
          placeholder="No group"
          options={data.categoryGroups.map((group) => ({ value: group.id, label: group.name }))}
          onChange={(category_group_id) => update({ category_group_id })}
        />
      )}
      {has('icon') && (
        <SelectField
          label="Icon"
          value={values.icon_id}
          placeholder={has('group') ? 'Use the group\'s icon' : 'No icon'}
          options={iconOptions}
          onChange={(icon_id) => update({ icon_id })}
        />
      )}
      {has('color') && <ColorField label="Color" value={values.color} onChange={(color) => update({ color })} error={errors.color} />}
      {has('assessed') && (
        <div className="form-field">
          <label className="choice">
            <input type="checkbox" checked={values.counts_as_assessed} onChange={(event) => update({ counts_as_assessed: event.target.checked })} />
            Counts as assessed
          </label>
          <span className="field-hint">
            Untick for a status that says where a unit is, such as turned-over or in inventory, rather than whether it works. Its units are left out of % operational on the dashboard, and shown apart as not yet assessed.
          </span>
        </div>
      )}
      {has('image') && (
        <div className="form-field">
          <label htmlFor="icon-svg-file">SVG file</label>
          <input id="icon-svg-file" type="file" accept=".svg,image/svg+xml" onChange={(event) => void readIconFile(event.target.files?.[0])} />
          <span className="field-hint">A simple one-color drawing with a viewBox, up to 20 KB. It's drawn in white on the map's markers.</span>
          {values.image && <img className="admin-icon admin-icon-large" src={iconPreview(values.image)} alt="Preview" />}
          {(fileProblem ?? errors.image) && <span className="field-error">{fileProblem ?? errors.image}</span>}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          Save
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function LookupSection({
  title,
  singular,
  description,
  table,
  rows,
  fields = [],
  data,
  usage,
  usageWord = 'record',
  hasCode = false,
  canArchive = true,
  canReorder = true,
  defaultColor = '#2e7d32',
  asPage = false,
}: LookupSectionProps) {
  const { store } = useStore();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const { busy, failure, notice, errors, run, clear } = useSaving();

  const active = useMemo(() => rows.filter((row) => row.is_active !== false), [rows]);
  const archived = useMemo(() => rows.filter((row) => row.is_active === false), [rows]);

  const open = (id: number | 'new' | null) => {
    clear();
    setEditing(id);
  };

  const valuesFrom = (form: FormValues, row: LookupRow | null): LookupValues => {
    const values: LookupValues = { name: form.name.trim() };
    if (fields.includes('color')) values.color = form.color;
    if (fields.includes('image')) values.image = form.image;
    if (fields.includes('icon')) values.icon_id = optionalId(form.icon_id);
    if (fields.includes('type')) values.intervention_type_id = optionalId(form.intervention_type_id);
    if (fields.includes('group')) values.category_group_id = optionalId(form.category_group_id);
    if (fields.includes('assessed')) values.counts_as_assessed = form.counts_as_assessed;
    if (fields.includes('label')) values.label = form.label.trim();
    if (fields.includes('position')) values.position = form.position.trim();
    if (!row) {
      if (hasCode) values.code = newCode(form.name, rows.map((r) => r.code ?? ''));
      if (canReorder) values.sort_order = active.length + 1;
    }
    return values;
  };

  const save = async (form: FormValues, row: LookupRow | null) => {
    const saved = await run(() => store.saveLookup(table, row?.id ?? null, valuesFrom(form, row)), `Saved ${form.name.trim()}.`);
    if (saved) setEditing(null);
  };

  const move = (id: number, direction: -1 | 1) =>
    run(async () => {
      for (const change of reordered(active as (LookupRow & { sort_order: number })[], id, direction)) {
        await store.saveLookup(table, change.id, { sort_order: change.sort_order });
      }
    });

  const setActive = (row: LookupRow, is_active: boolean) =>
    run(() => store.saveLookup(table, row.id, { is_active }), `${row.name} ${is_active ? 'is back on the lists' : 'is archived. Existing records keep it, but it isn\'t offered for new ones'}.`);

  const iconOf = (row: LookupRow): Icon | undefined => data.icons.find((icon) => icon.id === row.icon_id);

  const rowView = (row: LookupRow, index: number, list: LookupRow[]) => {
    if (editing === row.id) {
      return (
        <li key={row.id} className="admin-row admin-row-editing">
          <LookupForm
            title={`Edit ${row.name}`}
            row={row}
            fields={fields}
            data={data}
            defaultColor={defaultColor}
            busy={busy}
            errors={errors}
            onSave={(form) => void save(form, row)}
            onCancel={() => open(null)}
          />
        </li>
      );
    }
    const type = data.types.find((t) => t.id === row.intervention_type_id);
    const group = data.categoryGroups.find((g) => g.id === row.category_group_id);
    const count = usage?.(row);
    return (
      <li key={row.id} className={`admin-row${row.is_active === false ? ' admin-row-archived' : ''}`} data-row={row.name}>
        {row.color && <Swatch color={row.color} />}
        {fields.includes('image') && row.image && <img className="admin-icon" src={iconPreview(row.image)} alt="" />}
        {fields.includes('icon') && <IconImage icon={iconOf(row)} />}
        <span className="admin-row-main">
          <strong>{row.name}</strong>
          <span className="field-hint">
            {[
              fields.includes('label') ? row.label : null,
              fields.includes('position') ? row.position || null : null,
              fields.includes('type') ? (type?.name ?? 'Any type') : null,
              fields.includes('group') ? (group?.name ?? 'No group') : null,
              count === undefined ? null : plural(count, usageWord),
              fields.includes('assessed') && row.counts_as_assessed === false ? 'Not counted as assessed' : null,
              row.is_active === false ? 'Archived' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="admin-row-actions">
          {canReorder && row.is_active !== false && (
            <MoveButtons
              name={row.name}
              disabled={busy}
              onUp={index > 0 ? () => void move(row.id, -1) : undefined}
              onDown={index < list.length - 1 ? () => void move(row.id, 1) : undefined}
            />
          )}
          <button type="button" className="secondary-button" onClick={() => open(row.id)}>
            Edit<span className="visually-hidden"> {row.name}</span>
          </button>
          {canArchive && (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void setActive(row, row.is_active === false)}>
              {row.is_active === false ? 'Restore' : 'Archive'}
              <span className="visually-hidden"> {row.name}</span>
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <SectionFrame
      title={title}
      description={description}
      asPage={asPage}
      action={
        <button type="button" className="primary-button admin-add" onClick={() => open('new')}>
          + Add {singular}
        </button>
      }
    >
      <Feedback failure={failure} notice={notice} />
      {editing === 'new' && (
        <LookupForm
          title={`Add ${singular}`}
          row={null}
          fields={fields}
          data={data}
          defaultColor={defaultColor}
          busy={busy}
          errors={errors}
          onSave={(form) => void save(form, null)}
          onCancel={() => open(null)}
        />
      )}
      {active.length === 0 && editing !== 'new' ? (
        <p className="admin-empty">Nothing here yet. Use + Add {singular} to make the first one.</p>
      ) : (
        <ul className="admin-list">{active.map(rowView)}</ul>
      )}
      {archived.length > 0 && (
        <>
          <h3 className="admin-subheading">Archived</h3>
          <ul className="admin-list">{archived.map(rowView)}</ul>
        </>
      )}
    </SectionFrame>
  );
}
