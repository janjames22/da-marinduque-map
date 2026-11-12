import { useMemo, useState, type FormEvent } from 'react';
import { ConflictError, ValidationError, type InterventionPatch } from '../data/store';
import type { Intervention, MapData } from '../data/types';
import { FLAG_LABELS, isOnMap, recordName } from '../lib/display';
import { computeFlags, editWarnings, linePartsOf, pointOf, samePoint } from '../lib/qa';
import type { FieldErrors } from '../lib/validation';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { useStore } from '../state/store-context';
import { PanelFrame, PlaceFields, SelectField, TextField, WarningList } from './FormParts';
import { LocationInput } from './LocationInput';

// Fixes what a flag points at, and records why. Flags clear themselves when the data agrees, except
// the name check, which a person clears.
export function ResolveForm({ data, record: latest }: { data: MapData; record: Intervention }) {
  // As it was when opened, so a change made elsewhere is noticed instead of being overwritten.
  const [record] = useState(latest);
  const { store, places } = useStore();
  const draft = useEditUi((state) => state.draft);
  const closePanel = useEditUi((state) => state.closePanel);
  const setNotice = useEditUi((state) => state.setNotice);
  const zoomToRecord = useMapUi((state) => state.zoomToRecord);

  const [municipalityId, setMunicipalityId] = useState(String(record.municipality_id));
  const [barangayId, setBarangayId] = useState(record.barangay_id === null ? '' : String(record.barangay_id));
  const [basisId, setBasisId] = useState(record.location_basis_id === null ? '' : String(record.location_basis_id));
  const [beneficiary, setBeneficiary] = useState(record.beneficiary ?? '');
  const [nameChecked, setNameChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasNameCheck = record.qa_flags.includes('beneficiary_name_check');
  const nextBarangay = barangayId === '' ? null : Number(barangayId);
  const nextBasis = basisId === '' ? null : Number(basisId);
  const nextBeneficiary = beneficiary.trim() === '' ? null : beneficiary.trim();

  // A road keeps its line here, as reshaping it isn't built yet.
  const isLine = data.types.find((type) => type.id === record.intervention_type_id)?.geometry_kind === 'line';
  const candidate = {
    id: record.id,
    point: isLine ? null : draft,
    ...(isLine ? { line: linePartsOf(record) } : {}),
    municipality_id: Number(municipalityId),
    barangay_id: nextBarangay,
    barangay_raw: record.barangay_raw,
    qa_flags: nameChecked ? record.qa_flags.filter((flag) => flag !== 'beneficiary_name_check') : record.qa_flags,
    deleted_at: null,
  };

  const warnings = useMemo(
    () =>
      editWarnings(
        { ...candidate, category_id: record.category_id, beneficiary: nextBeneficiary, year_funded: record.year_funded },
        data.interventions,
        places,
        data,
      ),
    // candidate is rebuilt from these on every render
    [draft, municipalityId, nextBarangay, nextBeneficiary, nameChecked, data, places, record],
  );
  const remaining = computeFlags(candidate, data.interventions, places);

  const patch: InterventionPatch = {};
  if (Number(municipalityId) !== record.municipality_id) patch.municipality_id = Number(municipalityId);
  if (nextBarangay !== record.barangay_id) patch.barangay_id = nextBarangay;
  if (nextBasis !== record.location_basis_id) patch.location_basis_id = nextBasis;
  if (nextBeneficiary !== record.beneficiary) patch.beneficiary = nextBeneficiary;
  const originalPoint = pointOf(record);
  if (!isLine && (draft === null ? originalPoint !== null : !samePoint(originalPoint, draft))) patch.point = draft;
  if (nameChecked) patch.clear_name_check = true;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: FieldErrors = {};
    if (reason.trim() === '') found.reason = 'Give a reason. It goes in the audit log.';
    if (Object.keys(patch).length === 0) {
      setErrors(found);
      setFailure('Nothing has changed yet.');
      return;
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      const saved = await store.updateIntervention(record.id, record.version, patch, { kind: 'resolve', reason: reason.trim() });
      closePanel();
      setNotice(saved.qa_flags.some((flag) => flag !== 'duplicate_point') ? 'Saved. Some flags remain.' : 'Saved. No flags remain.');
      if (isOnMap(saved)) zoomToRecord(saved.id);
    } catch (error) {
      if (error instanceof ValidationError) {
        setErrors(error.fields);
        setFailure(error.message);
      } else if (error instanceof ConflictError) {
        setFailure('Someone else just changed this record. Close this panel and open it again to see the latest version.');
      } else {
        setFailure(`Could not save: ${(error as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelFrame title="Resolve flag" subtitle={recordName(record, data)} onClose={closePanel}>
      <form className="edit-form" onSubmit={submit} noValidate aria-label="Resolve flag">
        <section aria-label="Current flags">
          <h3 className="section-title">Flagged for</h3>
          <ul className="flag-list">
            {record.qa_flags.map((flag) => (
              <li key={flag}>{FLAG_LABELS[flag] ?? flag}</li>
            ))}
          </ul>
          {record.barangay_raw && <p className="field-hint">The source says: {record.barangay_raw}</p>}
        </section>

        <PlaceFields
          data={data}
          municipalityId={municipalityId}
          barangayId={barangayId}
          errors={errors}
          onChange={(municipality, barangay) => {
            setMunicipalityId(municipality);
            setBarangayId(barangay);
          }}
        />
        {!isLine && <LocationInput />}
        <SelectField
          label="Location basis"
          value={basisId}
          placeholder="Not set"
          options={data.locationBases.filter((b) => b.is_active || String(b.id) === basisId).map((b) => ({ value: b.id, label: b.name }))}
          onChange={setBasisId}
        />

        {hasNameCheck && (
          <fieldset>
            <legend>Beneficiary name</legend>
            <TextField label="Beneficiary" value={beneficiary} onChange={setBeneficiary} />
            <label className="choice">
              <input type="checkbox" checked={nameChecked} onChange={(event) => setNameChecked(event.target.checked)} />
              <span>The name has been checked</span>
            </label>
          </fieldset>
        )}

        <WarningList
          result={warnings}
          onUsePlotted={(municipality, barangay) => {
            setMunicipalityId(String(municipality));
            setBarangayId(String(barangay));
          }}
        />
        <p className="field-hint" data-testid="flags-after-saving">
          {remaining.length === 0 ? 'No flags will remain after saving.' : `After saving: ${remaining.map((flag) => FLAG_LABELS[flag] ?? flag).join('; ')}.`}
        </p>
        {remaining.includes('barangay_mismatch') && (
          <p className="field-hint">
            A mismatch clears only when the barangay and the point agree. Setting the location basis records why they differ, but doesn't clear it.
          </p>
        )}

        <TextField label="Reason for this change" required multiline value={reason} onChange={setReason} error={errors.reason} />

        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            Save and log
          </button>
          <button type="button" className="secondary-button" onClick={closePanel}>
            Cancel
          </button>
        </div>
      </form>
    </PanelFrame>
  );
}
