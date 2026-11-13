-- Phase 16b: a road's line, drawn on the map, saved through the same functions as everything else. The
-- screens send the line as [longitude, latitude] pairs in order, under "line", beside "point". A patch
-- with "line" set to null takes the line away, and the road waits for one again.
--
-- create_intervention and update_intervention are as 0007_admin.sql left them, with the line added.

-- ---------------------------------------------------------------------------
-- A line from the screens
-- ---------------------------------------------------------------------------

create function public.line_from_json(line jsonb)
returns extensions.geometry
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  position jsonb;
begin
  if line is null or jsonb_typeof(line) = 'null' then
    return null;
  end if;
  if jsonb_typeof(line) <> 'array' or jsonb_array_length(line) < 2 then
    raise exception 'a line needs at least two points' using errcode = 'check_violation';
  end if;
  for position in select value from jsonb_array_elements(line) loop
    if jsonb_typeof(position) <> 'array' or jsonb_array_length(position) <> 2
      or jsonb_typeof(position -> 0) <> 'number' or jsonb_typeof(position -> 1) <> 'number' then
      raise exception 'each point of a line is a longitude and a latitude' using errcode = 'check_violation';
    end if;
  end loop;
  return ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', line)::text), 4326);
end;
$$;

-- A point or a line, whichever the values carry. Both at once is a mistake, not a choice.
create function public.shape_from_json(p_values jsonb)
returns extensions.geometry
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
begin
  if p_values ? 'point' and jsonb_typeof(p_values -> 'point') <> 'null'
    and p_values ? 'line' and jsonb_typeof(p_values -> 'line') <> 'null' then
    raise exception 'a record has a point or a line, not both' using errcode = 'check_violation';
  end if;
  return coalesce(public.point_from_json(p_values -> 'point'), public.line_from_json(p_values -> 'line'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Adding and editing a record
-- ---------------------------------------------------------------------------

create or replace function public.create_intervention(p_values jsonb, p_status jsonb, p_photo jsonb default null, p_note jsonb default null)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  new_id uuid;
begin
  perform public.require_editor();
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);

  insert into public.interventions (
    id, intervention_type_id, category_id, title, banner_program_id, year_funded, quantity, unit_cost,
    fund_source, beneficiary, beneficiary_type_id, municipality_id, barangay_id, location_basis_id,
    geom, attributes, remarks
  ) values (
    coalesce((p_values ->> 'id')::uuid, gen_random_uuid()),
    (p_values ->> 'intervention_type_id')::smallint,
    (p_values ->> 'category_id')::smallint,
    nullif(btrim(p_values ->> 'title'), ''),
    (p_values ->> 'banner_program_id')::smallint,
    (p_values ->> 'year_funded')::integer,
    coalesce((p_values ->> 'quantity')::integer, 1),
    (p_values ->> 'unit_cost')::numeric,
    nullif(btrim(p_values ->> 'fund_source'), ''),
    nullif(btrim(p_values ->> 'beneficiary'), ''),
    (p_values ->> 'beneficiary_type_id')::smallint,
    (p_values ->> 'municipality_id')::smallint,
    (p_values ->> 'barangay_id')::integer,
    (p_values ->> 'location_basis_id')::smallint,
    public.shape_from_json(p_values),
    coalesce(p_values -> 'attributes', '{}'::jsonb),
    nullif(btrim(p_values ->> 'remarks'), '')
  )
  returning id into new_id;

  perform public.add_status_row(new_id, p_status, p_photo);
  perform public.add_field_photos(new_id, p_values -> 'field_photos');
  return public.intervention_json(new_id);
end;
$$;

create or replace function public.update_intervention(p_id uuid, p_expected_version integer, p_patch jsonb, p_note jsonb default null)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_editor();
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);
  if p_patch ? 'point' and p_patch ? 'line' then
    raise exception 'a record has a point or a line, not both' using errcode = 'check_violation';
  end if;

  update public.interventions set
    category_id = case when p_patch ? 'category_id' then (p_patch ->> 'category_id')::smallint else category_id end,
    title = case when p_patch ? 'title' then nullif(btrim(p_patch ->> 'title'), '') else title end,
    banner_program_id = case when p_patch ? 'banner_program_id' then (p_patch ->> 'banner_program_id')::smallint else banner_program_id end,
    year_funded = case when p_patch ? 'year_funded' then (p_patch ->> 'year_funded')::integer else year_funded end,
    quantity = case when p_patch ? 'quantity' then (p_patch ->> 'quantity')::integer else quantity end,
    unit_cost = case when p_patch ? 'unit_cost' then (p_patch ->> 'unit_cost')::numeric else unit_cost end,
    fund_source = case when p_patch ? 'fund_source' then nullif(btrim(p_patch ->> 'fund_source'), '') else fund_source end,
    beneficiary = case when p_patch ? 'beneficiary' then nullif(btrim(p_patch ->> 'beneficiary'), '') else beneficiary end,
    beneficiary_type_id = case when p_patch ? 'beneficiary_type_id' then (p_patch ->> 'beneficiary_type_id')::smallint else beneficiary_type_id end,
    municipality_id = case when p_patch ? 'municipality_id' then (p_patch ->> 'municipality_id')::smallint else municipality_id end,
    barangay_id = case when p_patch ? 'barangay_id' then (p_patch ->> 'barangay_id')::integer else barangay_id end,
    location_basis_id = case when p_patch ? 'location_basis_id' then (p_patch ->> 'location_basis_id')::smallint else location_basis_id end,
    geom = case
      when p_patch ? 'point' then public.point_from_json(p_patch -> 'point')
      when p_patch ? 'line' then public.line_from_json(p_patch -> 'line')
      else geom
    end,
    attributes = case when p_patch ? 'attributes' then p_patch -> 'attributes' else attributes end,
    remarks = case when p_patch ? 'remarks' then nullif(btrim(p_patch ->> 'remarks'), '') else remarks end,
    qa_flags = case
      when coalesce((p_patch ->> 'clear_name_check')::boolean, false) then array_remove(qa_flags, 'beneficiary_name_check')
      else qa_flags
    end
  where id = p_id and version = p_expected_version and deleted_at is null;

  if not found then
    raise exception 'This record was changed by someone else.' using errcode = 'DA409';
  end if;
  perform public.add_field_photos(p_id, p_patch -> 'field_photos');
  return public.intervention_json(p_id);
end;
$$;

-- Default execute is off since 0005_access_control.sql. These run as the person saving, as
-- point_from_json does.
revoke all on function public.line_from_json(jsonb), public.shape_from_json(jsonb) from public, anon;
grant execute on function public.line_from_json(jsonb), public.shape_from_json(jsonb) to authenticated;
