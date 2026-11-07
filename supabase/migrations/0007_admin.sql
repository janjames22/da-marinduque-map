-- Phase 6: what Admins need to change the app's own lists and forms from the website. The browser's
-- copy of these rules is in src/modules/intervention-map/lib/admin-rules.ts, and tests/admin.test.ts
-- runs both on the same cases, so change them together.

-- ---------------------------------------------------------------------------
-- Versions, so two Admins can't silently overwrite each other's changes to a form
-- ---------------------------------------------------------------------------

alter table public.intervention_types add column version integer not null default 1;
alter table public.barangay_field_schema add column version integer not null default 1;

-- ---------------------------------------------------------------------------
-- Field schemas: options need a value and a label, and a value can only be used once in a field
-- ---------------------------------------------------------------------------

create or replace function public.validate_field_schema(schema jsonb)
returns void
language plpgsql
immutable
as $$
declare
  field jsonb;
  field_key text;
  input text;
  seen text[] := '{}';
  choice jsonb;
  values_seen text[];
begin
  if jsonb_typeof(schema -> 'fields') is distinct from 'array' then
    raise exception 'field schema must have a "fields" array' using errcode = 'check_violation';
  end if;

  for field in select value from jsonb_array_elements(schema -> 'fields') loop
    field_key := field ->> 'key';
    input := field ->> 'input';

    if field_key is null or field_key !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'invalid field key: %', coalesce(field_key, '(none)') using errcode = 'check_violation';
    end if;
    if field_key = any(seen) then
      raise exception 'duplicate field key: %', field_key using errcode = 'check_violation';
    end if;
    seen := seen || field_key;

    if btrim(coalesce(field ->> 'label', '')) = '' then
      raise exception 'field % needs a label', field_key using errcode = 'check_violation';
    end if;
    if input is null or input not in ('text', 'number', 'date', 'dropdown', 'yes_no', 'photo') then
      raise exception 'field % has invalid input kind: %', field_key, coalesce(input, '(none)')
        using errcode = 'check_violation';
    end if;
    if input = 'dropdown' then
      if jsonb_typeof(field -> 'options') is distinct from 'array' or jsonb_array_length(field -> 'options') = 0 then
        raise exception 'dropdown field % needs options', field_key using errcode = 'check_violation';
      end if;
      values_seen := '{}';
      for choice in select value from jsonb_array_elements(field -> 'options') loop
        if btrim(coalesce(choice ->> 'value', '')) = '' or btrim(coalesce(choice ->> 'label', '')) = '' then
          raise exception 'an option of field % needs a value and a label', field_key using errcode = 'check_violation';
        end if;
        if choice ->> 'value' = any(values_seen) then
          raise exception 'field % has the option % twice', field_key, choice ->> 'value' using errcode = 'check_violation';
        end if;
        values_seen := values_seen || (choice ->> 'value');
      end loop;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Intervention types
-- ---------------------------------------------------------------------------

create or replace function public.intervention_types_before_write()
returns trigger
language plpgsql
as $$
declare
  rule record;
begin
  perform public.validate_field_schema(new.field_schema);

  for rule in select key, value #>> '{}' as val from jsonb_each(new.core_field_rules) loop
    if rule.key not in (
      'category_id', 'title', 'banner_program_id', 'year_funded', 'quantity', 'unit_cost',
      'fund_source', 'beneficiary', 'beneficiary_type_id', 'remarks'
    ) then
      raise exception 'unknown standard field: %', rule.key using errcode = 'check_violation';
    end if;
    if rule.val not in ('required', 'optional', 'hidden') then
      raise exception 'invalid rule for %: %', rule.key, rule.val using errcode = 'check_violation';
    end if;
  end loop;

  -- A record needs one or the other to have a name, so a type can't hide both.
  if new.core_field_rules ->> 'category_id' = 'hidden' and new.core_field_rules ->> 'title' = 'hidden' then
    raise exception 'category and title cannot both be hidden' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    perform public.check_field_schema_change(old.field_schema, new.field_schema);

    if new.code <> old.code then
      raise exception 'code cannot change once created' using errcode = 'check_violation';
    end if;
    if new.geometry_kind <> old.geometry_kind and exists (
      select 1 from public.interventions where intervention_type_id = new.id
    ) then
      raise exception 'geometry kind cannot change once a type has records' using errcode = 'check_violation';
    end if;

    new.version := old.version + 1;
  end if;

  return new;
end;
$$;

-- A status can't leave a type's list while a record is at it, as the record would have a status
-- that its form no longer knows. A status that's only in a record's past is fine: the past stays.
create function public.type_status_before_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.interventions i
    where i.intervention_type_id = old.intervention_type_id and i.status_id = old.status_id and i.deleted_at is null
  ) then
    raise exception 'records are at this status, so it stays on the list until they move on' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger type_status_before_delete
  before delete on public.intervention_type_statuses
  for each row execute function public.type_status_before_delete();

grant delete on public.intervention_type_statuses to authenticated;

create policy "admins remove" on public.intervention_type_statuses
  for delete to authenticated using ((select public.current_user_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- The barangay form. It's the same builder, but photos belong to a record, so it has no photo fields.
-- ---------------------------------------------------------------------------

create or replace function public.barangay_field_schema_before_write()
returns trigger
language plpgsql
as $$
begin
  perform public.validate_field_schema(new.field_schema);
  if exists (select 1 from jsonb_array_elements(new.field_schema -> 'fields') f where f.value ->> 'input' = 'photo') then
    raise exception 'barangay fields cannot be photos' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    perform public.check_field_schema_change(old.field_schema, new.field_schema);
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lookups: a code never changes, a name can't be blank, and an icon has to be a plain drawing
-- ---------------------------------------------------------------------------

create function public.keep_code_stable()
returns trigger
language plpgsql
as $$
begin
  if new.code <> old.code then
    raise exception 'code cannot change once created' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['programs', 'category_groups', 'categories'] loop
    execute format(
      'create trigger keep_code_stable before update on public.%I
       for each row execute function public.keep_code_stable()',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'icons', 'programs', 'category_groups', 'categories', 'statuses', 'beneficiary_types',
    'location_bases', 'intervention_types'
  ] loop
    execute format(
      'alter table public.%I add constraint %I check (btrim(name) <> '''')',
      table_name, table_name || '_name_not_blank'
    );
  end loop;
end;
$$;

-- Icons are drawn through <img> and on a canvas, where scripts don't run, but a file that isn't a
-- plain drawing has no business here, and can't be turned into a PNG for KMZ files either.
create function public.icons_before_write()
returns trigger
language plpgsql
as $$
begin
  if length(new.image) > 20000
    or new.image !~ '^<svg\s'
    or new.image !~ '</svg>\s*$'
    or new.image !~* '\sviewBox\s*=' then
    raise exception 'an icon must be an SVG of up to 20 KB with a viewBox' using errcode = 'check_violation';
  end if;
  if new.image ~* '<\s*(script|style|image|foreignobject|iframe|embed|object|use|a|animate[a-z]*|set)[\s/>]'
    or new.image ~* '\son[a-z]+\s*='
    or new.image ~* 'href'
    or new.image ~* 'url\s*\(' then
    raise exception 'an icon can only hold shapes, not scripts or links' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger icons_before_write
  before insert or update of image on public.icons
  for each row execute function public.icons_before_write();

-- ---------------------------------------------------------------------------
-- There must always be an active Admin, or nobody could give access to anyone again
-- ---------------------------------------------------------------------------

create function public.profiles_keep_an_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.role = 'admin' and old.deactivated_at is null
    and (tg_op = 'DELETE' or new.role <> 'admin' or new.deactivated_at is not null)
    and not exists (
      select 1 from public.profiles p where p.role = 'admin' and p.deactivated_at is null and p.id <> old.id
    ) then
    raise exception 'There has to be at least one active Admin, so this change was refused.' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_keep_an_admin
  before update of role, deactivated_at or delete on public.profiles
  for each row execute function public.profiles_keep_an_admin();

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create function public.require_admin()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an Admin can change this.' using errcode = '42501';
  end if;
end;
$$;

-- A type and its status list are one change, so a new type can't be left without statuses.
create function public.save_intervention_type(
  p_id integer,
  p_expected_version integer,
  p_values jsonb,
  p_statuses jsonb,
  p_note jsonb default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  saved public.intervention_types;
  entry record;
begin
  perform public.require_admin();
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);

  if jsonb_typeof(p_statuses) is distinct from 'array' or jsonb_array_length(p_statuses) = 0 then
    raise exception 'A type needs at least one status.' using errcode = 'check_violation';
  end if;
  if (select count(*) from jsonb_array_elements(p_statuses) s where (s.value ->> 'is_default')::boolean) <> 1 then
    raise exception 'Choose one status as the default.' using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.intervention_types (code, name, geometry_kind, icon_id, color, core_field_rules, field_schema, sort_order, is_active)
    values (
      p_values ->> 'code',
      btrim(p_values ->> 'name'),
      (p_values ->> 'geometry_kind')::public.geometry_kind,
      (p_values ->> 'icon_id')::smallint,
      p_values ->> 'color',
      coalesce(p_values -> 'core_field_rules', '{}'::jsonb),
      coalesce(p_values -> 'field_schema', '{"fields": []}'::jsonb),
      coalesce((p_values ->> 'sort_order')::smallint, 0),
      coalesce((p_values ->> 'is_active')::boolean, true)
    )
    returning * into saved;
  else
    update public.intervention_types set
      name = btrim(p_values ->> 'name'),
      geometry_kind = (p_values ->> 'geometry_kind')::public.geometry_kind,
      icon_id = (p_values ->> 'icon_id')::smallint,
      color = p_values ->> 'color',
      core_field_rules = p_values -> 'core_field_rules',
      field_schema = p_values -> 'field_schema',
      sort_order = (p_values ->> 'sort_order')::smallint,
      is_active = (p_values ->> 'is_active')::boolean
    where id = p_id and version = p_expected_version
    returning * into saved;

    if saved.id is null then
      raise exception 'This type was changed by someone else.' using errcode = 'DA409';
    end if;
  end if;

  delete from public.intervention_type_statuses
  where intervention_type_id = saved.id
    and status_id not in (select (s.value ->> 'status_id')::smallint from jsonb_array_elements(p_statuses) s);

  -- Only one default is allowed at a time, so the old one clears first.
  update public.intervention_type_statuses set is_default = false where intervention_type_id = saved.id and is_default;

  for entry in
    select s.value, s.ordinality from jsonb_array_elements(p_statuses) with ordinality s
  loop
    insert into public.intervention_type_statuses (intervention_type_id, status_id, sort_order, is_default, counts_as_operational)
    values (
      saved.id,
      (entry.value ->> 'status_id')::smallint,
      entry.ordinality,
      (entry.value ->> 'is_default')::boolean,
      coalesce((entry.value ->> 'counts_as_operational')::boolean, false)
    )
    on conflict (intervention_type_id, status_id) do update
    set sort_order = excluded.sort_order,
        is_default = excluded.is_default,
        counts_as_operational = excluded.counts_as_operational;
  end loop;

  return to_jsonb(saved);
end;
$$;

create function public.save_barangay_fields(p_expected_version integer, p_schema jsonb, p_note jsonb default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  saved public.barangay_field_schema;
begin
  perform public.require_admin();
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);

  update public.barangay_field_schema set field_schema = p_schema
  where id and version = p_expected_version
  returning * into saved;

  if saved.id is null then
    raise exception 'The barangay fields were changed by someone else.' using errcode = 'DA409';
  end if;
  return to_jsonb(saved);
end;
$$;

-- ---------------------------------------------------------------------------
-- Photo fields. The value is the id of a row in intervention_photos, saved with the record.
-- ---------------------------------------------------------------------------

create function public.add_field_photos(intervention uuid, photos jsonb)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  photo jsonb;
begin
  if photos is null or jsonb_typeof(photos) <> 'array' then
    return;
  end if;
  for photo in select value from jsonb_array_elements(photos) loop
    -- Files are stored under their record, and this keeps another record's photo from being attached.
    if not starts_with(photo ->> 'storage_path', intervention::text || '/') then
      raise exception 'The photo is not stored under this record.' using errcode = 'check_violation';
    end if;
    insert into public.intervention_photos (id, intervention_id, storage_path, caption, taken_at, exif_location)
    values (
      (photo ->> 'id')::uuid,
      intervention,
      photo ->> 'storage_path',
      nullif(btrim(photo ->> 'caption'), ''),
      (photo ->> 'taken_at')::timestamptz,
      public.point_from_json(photo -> 'exif_location')
    );
  end loop;
end;
$$;

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
    public.point_from_json(p_values -> 'point'),
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
    geom = case when p_patch ? 'point' then public.point_from_json(p_patch -> 'point') else geom end,
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

grant execute on function
  public.require_admin(),
  public.save_intervention_type(integer, integer, jsonb, jsonb, jsonb),
  public.save_barangay_fields(integer, jsonb, jsonb),
  public.add_field_photos(uuid, jsonb)
to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates: a change to a list or a form reaches every open map, without a code release
-- ---------------------------------------------------------------------------

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'icons', 'programs', 'category_groups', 'categories', 'statuses', 'beneficiary_types',
    'location_bases', 'intervention_types', 'intervention_type_statuses', 'barangay_field_schema'
  ] loop
    execute format(
      'create trigger signal_map_change after insert or update or delete on public.%I
       for each statement execute function public.signal_map_change()',
      table_name
    );
  end loop;
end;
$$;
