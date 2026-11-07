import type { MapData } from '../data/types';
import { emptyFilter, NOT_SET, viewFields, type FieldFilter, type ViewField } from '../lib/view-fields';
import { useMapUi } from '../state/map-ui';

// Fields grouped as they belong: the record's own, then each type's custom fields.
export function FieldOptions({ fields }: { fields: ViewField[] }) {
  const groups = [...new Set(fields.map((field) => field.group))];
  return groups.map((group) => (
    <optgroup key={group} label={group}>
      {fields
        .filter((field) => field.group === group)
        .map((field) => (
          <option key={field.id} value={field.id}>
            {field.label}
          </option>
        ))}
    </optgroup>
  ));
}

const numberOrNull = (text: string) => (text === '' || !Number.isFinite(Number(text)) ? null : Number(text));

function FilterControl({ filter, field }: { filter: FieldFilter; field: ViewField | undefined }) {
  const update = useMapUi((state) => state.updateFieldFilter);
  const label = field?.label ?? filter.field;

  switch (filter.kind) {
    case 'choice': {
      const choices = [...(field?.choices ?? []), { value: NOT_SET, label: 'Not set' }];
      const toggle = (value: string, on: boolean) => update({ ...filter, values: on ? [...filter.values, value] : filter.values.filter((other) => other !== value) });
      return (
        <div className="filter-choices" role="group" aria-label={label}>
          {choices.map((choice) => (
            <label className="choice" key={choice.value}>
              <input type="checkbox" checked={filter.values.includes(choice.value)} onChange={(event) => toggle(choice.value, event.target.checked)} />
              {choice.label}
            </label>
          ))}
        </div>
      );
    }
    case 'number':
      return (
        <div className="field-row">
          <label className="field">
            <span>From</span>
            <input type="number" step="any" value={filter.min ?? ''} aria-label={`${label} from`} onChange={(event) => update({ ...filter, min: numberOrNull(event.target.value) })} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="number" step="any" value={filter.max ?? ''} aria-label={`${label} to`} onChange={(event) => update({ ...filter, max: numberOrNull(event.target.value) })} />
          </label>
        </div>
      );
    case 'date':
      return (
        <div className="field-row">
          <label className="field">
            <span>From</span>
            <input type="date" value={filter.from ?? ''} aria-label={`${label} from`} onChange={(event) => update({ ...filter, from: event.target.value || null })} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={filter.to ?? ''} aria-label={`${label} to`} onChange={(event) => update({ ...filter, to: event.target.value || null })} />
          </label>
        </div>
      );
    case 'text':
      return (
        <label className="field">
          <span>Contains</span>
          <input type="text" value={filter.text} aria-label={`${label} contains`} onChange={(event) => update({ ...filter, text: event.target.value })} />
        </label>
      );
  }
}

export function FieldFilters({ data }: { data: MapData }) {
  const filters = useMapUi((state) => state.fieldFilters);
  const add = useMapUi((state) => state.addFieldFilter);
  const remove = useMapUi((state) => state.removeFieldFilter);

  const fields = viewFields(data);
  const inUse = new Set(filters.map((filter) => filter.field));
  // Municipality has its own control above. An archived field stays filterable while a view uses it.
  const available = fields.filter((field) => !inUse.has(field.id) && !field.archived && field.id !== 'municipality');

  return (
    <>
      {filters.map((filter) => {
        const field = fields.find((candidate) => candidate.id === filter.field);
        const label = field?.label ?? filter.field;
        return (
          <div className="field-filter" key={filter.field} data-filter={filter.field}>
            <div className="field-filter-header">
              <span>{field && field.group !== 'Record' ? `${label} (${field.group})` : label}</span>
              <button type="button" className="link-button" onClick={() => remove(filter.field)}>
                Remove<span className="visually-hidden"> the {label} filter</span>
              </button>
            </div>
            <FilterControl filter={filter} field={field} />
          </div>
        );
      })}
      <label className="field">
        <span>Filter by another field</span>
        <select
          value=""
          onChange={(event) => {
            const field = fields.find((candidate) => candidate.id === event.target.value);
            if (field) add(emptyFilter(field));
          }}
        >
          <option value="">Choose a field</option>
          <FieldOptions fields={available} />
        </select>
      </label>
    </>
  );
}
