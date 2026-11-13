-- Phase 16c: lines from imported files. A file's road can come as one line, saved as a LineString as a
-- drawn one is, or as a line in several parts, which a file can bring and the forms can't draw. The
-- screens send the parts under "line_parts", each part [longitude, latitude] pairs in order.
--
-- import_records is as 0010_import_qa.sql left it, with the shape read by shape_from_json, as
-- create_intervention reads it since 0013_line_drawing.sql. A point still comes in as before.

-- ---------------------------------------------------------------------------
-- A line in parts
-- ---------------------------------------------------------------------------

create function public.lines_from_json(parts jsonb)
returns extensions.geometry
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  line jsonb;
begin
  if parts is null or jsonb_typeof(parts) = 'null' then
    return null;
  end if;
  if jsonb_typeof(parts) <> 'array' or jsonb_array_length(parts) = 0 then
    raise exception 'a line in parts needs at least one part' using errcode = 'check_violation';
  end if;
  -- Each part by line_from_json's rules, which refuses a part of fewer than two points.
  for line in select value from jsonb_array_elements(parts) loop
    perform public.line_from_json(line);
  end loop;
  return ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'MultiLineString', 'coordinates', parts)::text), 4326);
end;
$$;

-- A point, a line, or a line in parts, whichever the values carry. More than one is a mistake.
create or replace function public.shape_from_json(p_values jsonb)
returns extensions.geometry
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  given integer := 0;
begin
  if p_values ? 'point' and jsonb_typeof(p_values -> 'point') <> 'null' then given := given + 1; end if;
  if p_values ? 'line' and jsonb_typeof(p_values -> 'line') <> 'null' then given := given + 1; end if;
  if p_values ? 'line_parts' and jsonb_typeof(p_values -> 'line_parts') <> 'null' then given := given + 1; end if;
  if given > 1 then
    raise exception 'a record has a point or a line, not both' using errcode = 'check_violation';
  end if;
  return coalesce(
    public.point_from_json(p_values -> 'point'),
    public.line_from_json(p_values -> 'line'),
    public.lines_from_json(p_values -> 'line_parts')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------

create or replace function public.import_records(p_batch jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  batch_id uuid;
  type_id smallint := (p_batch ->> 'intervention_type_id')::smallint;
  source text := nullif(btrim(p_batch ->> 'data_source'), '');
  file text := nullif(btrim(p_batch ->> 'file_name'), '');
  item jsonb;
  record_values jsonb;
  record_status jsonb;
  new_id uuid;
  rows_done integer := 0;
begin
  perform public.require_editor();
  if source is null then
    raise exception 'An import needs a data source, such as "ABEMIS export".' using errcode = 'check_violation';
  end if;
  if file is null then
    raise exception 'An import needs the name of its file.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'An import needs at least one row.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'An import takes up to 2,000 rows at a time. Split the file and import each part.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.intervention_types where id = type_id and is_active) then
    raise exception 'An import needs an active intervention type.' using errcode = 'check_violation';
  end if;

  perform set_config('app.hold_signals', 'on', true);
  perform set_config('app.audit_context', jsonb_build_object('kind', 'import', 'file_name', file)::text, true);

  insert into public.import_batches (file_name, data_source, intervention_type_id, column_mapping, imported_by)
  values (file, source, type_id, coalesce(p_batch -> 'column_mapping', '{}'::jsonb), auth.uid())
  returning id into batch_id;

  for item in select value from jsonb_array_elements(p_rows) loop
    rows_done := rows_done + 1;
    record_values := coalesce(item -> 'values', '{}'::jsonb);
    record_status := coalesce(item -> 'status', '{}'::jsonb);
    begin
      insert into public.interventions (
        intervention_type_id, category_id, title, banner_program_id, year_funded, quantity, unit_cost,
        fund_source, beneficiary, beneficiary_type_id, municipality_id, barangay_id, barangay_raw,
        location_basis_id, geom, attributes, remarks, data_source, import_batch_id, source_id, source_raw
      ) values (
        type_id,
        (record_values ->> 'category_id')::smallint,
        nullif(btrim(record_values ->> 'title'), ''),
        (record_values ->> 'banner_program_id')::smallint,
        (record_values ->> 'year_funded')::integer,
        coalesce((record_values ->> 'quantity')::integer, 1),
        (record_values ->> 'unit_cost')::numeric,
        nullif(btrim(record_values ->> 'fund_source'), ''),
        nullif(btrim(record_values ->> 'beneficiary'), ''),
        (record_values ->> 'beneficiary_type_id')::smallint,
        (record_values ->> 'municipality_id')::smallint,
        (record_values ->> 'barangay_id')::integer,
        nullif(btrim(record_values ->> 'barangay_raw'), ''),
        (record_values ->> 'location_basis_id')::smallint,
        public.shape_from_json(record_values),
        coalesce(record_values -> 'attributes', '{}'::jsonb),
        nullif(btrim(record_values ->> 'remarks'), ''),
        source,
        batch_id,
        nullif(btrim(item ->> 'source_id'), ''),
        item -> 'source_raw'
      )
      returning id into new_id;

      insert into public.status_history (intervention_id, status_id, status_date, date_basis, source_note, remarks)
      values (
        new_id,
        (record_status ->> 'status_id')::smallint,
        (record_status ->> 'status_date')::date,
        coalesce(record_status ->> 'date_basis', 'as_of'),
        source,
        nullif(btrim(record_status ->> 'remarks'), '')
      );
    exception when others then
      raise exception 'Row %: %', coalesce(item ->> 'row', rows_done::text), sqlerrm using errcode = sqlstate;
    end;
  end loop;

  -- Flagged as the dashboard counts it: a shared point alone is often right, so it isn't counted.
  update public.import_batches
  set counts = (
    select jsonb_build_object('records', count(*), 'flagged', count(*) filter (where array_remove(qa_flags, 'duplicate_point') <> '{}'))
    from public.interventions where import_batch_id = batch_id
  )
  where id = batch_id;

  perform set_config('app.hold_signals', 'off', true);
  perform public.send_map_signal('interventions');
  return jsonb_build_object('id', batch_id, 'records', rows_done);
end;
$$;

-- Default execute is off since 0005_access_control.sql. This runs as the person saving, as
-- line_from_json does.
revoke all on function public.lines_from_json(jsonb) from public, anon;
grant execute on function public.lines_from_json(jsonb) to authenticated;
