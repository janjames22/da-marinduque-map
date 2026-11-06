-- Phase 4: who can do what, how the app writes, photo storage and live change signals.
--
-- Row-level security decides which rows a role can touch, and column grants decide which columns.
-- The app writes through the functions below, because a change and its audit reason have to share
-- one transaction, and so do a record and its first status. Those functions run as the caller
-- wherever they can, so the same policies apply to them as to a direct request.

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

-- A person who leaves keeps their name on what they did, so their profile can't be deleted.
-- Deactivating them removes all access while keeping that history.
alter table public.profiles add column deactivated_at timestamptz;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid() and deactivated_at is null;
$$;

-- Records made through the functions below have no other source to name.
alter table public.interventions alter column data_source set default 'Encoded on the map';

-- ---------------------------------------------------------------------------
-- Grants. Nothing is available to a role unless it is listed here.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- Functions are executable by everyone unless this is turned off, and it can't be set per schema.
alter default privileges revoke execute on functions from public;

grant select on all tables in schema public to authenticated;

-- version, status_id, qa flags other than the manual one, and the updated_* columns come from the
-- triggers. created_by comes from the caller's login. deleted_at only changes through the two
-- functions below, source_raw and the import columns only through imports.
grant insert (
  id, intervention_type_id, category_id, title, banner_program_id, year_funded, quantity, unit_cost,
  fund_source, beneficiary, beneficiary_type_id, municipality_id, barangay_id, location_basis_id,
  geom, attributes, remarks
) on public.interventions to authenticated;

grant update (
  category_id, title, banner_program_id, year_funded, quantity, unit_cost, fund_source, beneficiary,
  beneficiary_type_id, municipality_id, barangay_id, location_basis_id, geom, attributes, remarks, qa_flags
) on public.interventions to authenticated;

grant insert (id, intervention_id, status_id, status_date, remarks, photo_id) on public.status_history to authenticated;
grant insert (id, intervention_id, storage_path, caption, taken_at, exif_location) on public.intervention_photos to authenticated;

-- Boundaries and names are official data, so only the baseline values can be edited.
grant update (attributes) on public.barangays to authenticated;

grant insert (id, full_name, role) on public.profiles to authenticated;
grant update (full_name, role, deactivated_at) on public.profiles to authenticated;

grant insert (name, config, is_shared), update (name, config, is_shared, updated_at), delete on public.saved_views to authenticated;

grant insert, update on
  public.icons, public.programs, public.category_groups, public.categories, public.statuses,
  public.beneficiary_types, public.location_bases, public.intervention_types,
  public.intervention_type_statuses, public.barangay_field_schema
to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy "admins read deleted interventions" on public.interventions
  for select to authenticated using ((select public.current_user_role()) = 'admin');

create policy "editors add interventions" on public.interventions
  for insert to authenticated with check ((select public.current_user_role()) in ('admin', 'encoder'));

create policy "editors edit live interventions" on public.interventions
  for update to authenticated
  using ((select public.current_user_role()) in ('admin', 'encoder') and deleted_at is null)
  with check ((select public.current_user_role()) in ('admin', 'encoder'));

create policy "editors add status entries" on public.status_history
  for insert to authenticated with check ((select public.current_user_role()) in ('admin', 'encoder'));

create policy "editors add photos" on public.intervention_photos
  for insert to authenticated with check ((select public.current_user_role()) in ('admin', 'encoder'));

create policy "editors edit baselines" on public.barangays
  for update to authenticated
  using ((select public.current_user_role()) in ('admin', 'encoder'))
  with check ((select public.current_user_role()) in ('admin', 'encoder'));

create policy "admins read profiles" on public.profiles
  for select to authenticated using ((select public.current_user_role()) = 'admin');

create policy "admins add profiles" on public.profiles
  for insert to authenticated with check ((select public.current_user_role()) = 'admin');

create policy "admins edit profiles" on public.profiles
  for update to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');

create policy "members add own views" on public.saved_views
  for insert to authenticated
  with check ((select public.current_user_role()) is not null and owner_id = (select auth.uid()));

create policy "members edit own views" on public.saved_views
  for update to authenticated
  using ((select public.current_user_role()) is not null and owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "members delete own views" on public.saved_views
  for delete to authenticated
  using ((select public.current_user_role()) is not null and owner_id = (select auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'icons', 'programs', 'category_groups', 'categories', 'statuses', 'beneficiary_types',
    'location_bases', 'intervention_types', 'intervention_type_statuses', 'barangay_field_schema'
  ] loop
    execute format(
      'create policy "admins add" on public.%I for insert to authenticated
       with check ((select public.current_user_role()) = ''admin'')',
      table_name
    );
    execute format(
      'create policy "admins edit" on public.%I for update to authenticated
       using ((select public.current_user_role()) = ''admin'')
       with check ((select public.current_user_role()) = ''admin'')',
      table_name
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes. Errors: 42501 is not allowed, DA409 is a version conflict, and 23514 is a broken rule.
-- ---------------------------------------------------------------------------

create function public.require_editor()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is null or public.current_user_role() = 'viewer' then
    raise exception 'Your account can only view records.' using errcode = '42501';
  end if;
end;
$$;

create function public.point_from_json(point jsonb)
returns extensions.geometry
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case
    when point is null or jsonb_typeof(point) = 'null' then null
    else ST_SetSRID(ST_MakePoint((point ->> 'lng')::float8, (point ->> 'lat')::float8), 4326)
  end;
$$;

-- What the app reads about a record: the same columns as its list, without the raw geometry.
create function public.intervention_json(record_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select to_jsonb(v) - 'geom' - 'source_raw' from public.interventions_v v where v.id = record_id;
$$;

create function public.add_status_row(intervention uuid, status jsonb, photo jsonb)
returns public.status_history
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  new_photo_id uuid;
  entry public.status_history;
begin
  if not exists (select 1 from public.interventions where id = intervention) then
    raise exception 'This record no longer exists.' using errcode = 'DA409';
  end if;

  if photo is not null and jsonb_typeof(photo) <> 'null' then
    -- Files are stored under their record, and this keeps another record's photo from being attached.
    if not starts_with(photo ->> 'storage_path', intervention::text || '/') then
      raise exception 'The photo is not stored under this record.' using errcode = 'check_violation';
    end if;
    insert into public.intervention_photos (id, intervention_id, storage_path, taken_at, exif_location)
    values (
      coalesce((photo ->> 'id')::uuid, gen_random_uuid()),
      intervention,
      photo ->> 'storage_path',
      (photo ->> 'taken_at')::timestamptz,
      public.point_from_json(photo -> 'exif_location')
    )
    returning id into new_photo_id;
  end if;

  insert into public.status_history (intervention_id, status_id, status_date, remarks, photo_id)
  values (
    intervention,
    (status ->> 'status_id')::smallint,
    (status ->> 'status_date')::date,
    nullif(btrim(status ->> 'remarks'), ''),
    new_photo_id
  )
  returning * into entry;

  return entry;
end;
$$;

create function public.create_intervention(p_values jsonb, p_status jsonb, p_photo jsonb default null, p_note jsonb default null)
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
  return public.intervention_json(new_id);
end;
$$;

-- Only the keys present in the patch change, so a field someone else just edited is left alone.
create function public.update_intervention(p_id uuid, p_expected_version integer, p_patch jsonb, p_note jsonb default null)
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
  return public.intervention_json(p_id);
end;
$$;

-- The next two run as the owner because of how row-level security treats an update: the changed
-- row must still be readable by the person making it, and a deleted record isn't readable by an
-- Encoder. The role is checked here instead.
create function public.soft_delete_intervention(p_id uuid, p_expected_version integer, p_note jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_editor();
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);

  update public.interventions set deleted_at = now()
  where id = p_id and version = p_expected_version and deleted_at is null;

  if not found then
    raise exception 'This record was changed by someone else.' using errcode = 'DA409';
  end if;
  return public.intervention_json(p_id);
end;
$$;

create function public.restore_intervention(p_id uuid, p_expected_version integer, p_note jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an Admin can restore a deleted record.' using errcode = '42501';
  end if;
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);

  update public.interventions set deleted_at = null
  where id = p_id and version = p_expected_version and deleted_at is not null;

  if not found then
    raise exception 'This record was changed by someone else.' using errcode = 'DA409';
  end if;
  return public.intervention_json(p_id);
end;
$$;

create function public.add_status(p_intervention_id uuid, p_status jsonb, p_photo jsonb default null, p_note jsonb default null)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_editor();
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);
  return to_jsonb(public.add_status_row(p_intervention_id, p_status, p_photo));
end;
$$;

create function public.update_barangay_baseline(p_id integer, p_expected_version integer, p_attributes jsonb, p_note jsonb default null)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  saved public.barangays;
begin
  perform public.require_editor();
  perform set_config('app.audit_context', coalesce(p_note::text, ''), true);

  update public.barangays set attributes = p_attributes
  where id = p_id and version = p_expected_version
  returning * into saved;

  if saved.id is null then
    raise exception 'This baseline was changed by someone else.' using errcode = 'DA409';
  end if;
  return to_jsonb(saved) - 'boundary';
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads that a role can't do directly
-- ---------------------------------------------------------------------------

-- Audit rows hold the raw source row and the geometry under its column name. The History panel
-- needs neither form.
create function public.audit_row_for_display(row_data jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when row_data ? 'geom' then (row_data - 'source_raw' - 'geom') || jsonb_build_object('geojson', row_data -> 'geom')
    else row_data - 'source_raw'
  end;
$$;

-- Encoders see one record's history at a time. audit_log itself stays Admin-only, and Viewers
-- only get the status timeline. A deleted record's history is for Admins, as the record is.
create function public.audit_for_intervention(p_id uuid)
returns table (
  id bigint,
  table_name text,
  record_id text,
  action text,
  old_row jsonb,
  new_row jsonb,
  actor_id uuid,
  actor_name text,
  context jsonb,
  at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  caller public.user_role := public.current_user_role();
begin
  if caller is null or caller = 'viewer' then
    raise exception 'Your account can''t see change history.' using errcode = '42501';
  end if;
  if caller = 'encoder' and not exists (
    select 1 from public.interventions i where i.id = p_id and i.deleted_at is null
  ) then
    return;
  end if;

  return query
  select
    a.id, a.table_name, a.record_id, a.action,
    public.audit_row_for_display(a.old_row),
    public.audit_row_for_display(a.new_row),
    a.actor_id, p.full_name, a.context, a.at
  from public.audit_log a
  left join public.profiles p on p.id = a.actor_id
  where (a.table_name = 'interventions' and a.record_id = p_id::text)
     or (a.table_name in ('status_history', 'intervention_photos')
         and coalesce(a.new_row, a.old_row) ->> 'intervention_id' = p_id::text)
  order by a.id;
end;
$$;

-- Names for "by whom" on a status entry. Only names: profiles itself holds roles, and is Admin-only.
create function public.member_names()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name from public.profiles p where public.current_user_role() is not null;
$$;

-- Everything is closed first, because functions made before the default changed are still open.
-- The first group is called from policies and from triggers that run as the caller.
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.current_user_role(),
  public.validate_field_schema(jsonb),
  public.check_field_schema_change(jsonb, jsonb),
  public.validate_attributes(jsonb, jsonb),
  public.require_editor(),
  public.point_from_json(jsonb),
  public.intervention_json(uuid),
  public.add_status_row(uuid, jsonb, jsonb),
  public.create_intervention(jsonb, jsonb, jsonb, jsonb),
  public.update_intervention(uuid, integer, jsonb, jsonb),
  public.soft_delete_intervention(uuid, integer, jsonb),
  public.restore_intervention(uuid, integer, jsonb),
  public.add_status(uuid, jsonb, jsonb, jsonb),
  public.update_barangay_baseline(integer, integer, jsonb, jsonb),
  public.audit_for_intervention(uuid),
  public.member_names()
to authenticated;

-- ---------------------------------------------------------------------------
-- Photos: a private bucket. Files are read through short-lived signed links.
-- Paths are <intervention id>/<photo id>.<extension>.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'intervention-photos', 'intervention-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "members read intervention photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'intervention-photos' and (select public.current_user_role()) is not null);

create policy "editors upload intervention photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'intervention-photos'
    and (select public.current_user_role()) in ('admin', 'encoder')
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]+$'
  );

-- Only for clearing up after a save that failed: once a photo is on a record, its file stays.
create policy "uploaders remove unused intervention photos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'intervention-photos'
    and owner_id = (select auth.uid())::text
    and (select public.current_user_role()) in ('admin', 'encoder')
    and not exists (select 1 from public.intervention_photos p where p.storage_path = name)
  );

-- ---------------------------------------------------------------------------
-- Live updates: a signal on a private channel, telling open maps to reload.
--
-- Realtime's table-change feed checks row-level security against the new row, so it would never
-- tell an Encoder that a record was soft-deleted. A signal holds no record data, so every member
-- can get all of them, and a table name is all it says.
-- ---------------------------------------------------------------------------

create function public.signal_map_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A missed signal only delays a refresh. It must never stop the save.
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'map-changes', true);
  exception when others then
    raise warning 'map change signal failed: %', sqlerrm;
  end;
  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['interventions', 'status_history', 'intervention_photos', 'barangays'] loop
    execute format(
      'create trigger signal_map_change after insert or update or delete on public.%I
       for each statement execute function public.signal_map_change()',
      table_name
    );
  end loop;
end;
$$;

create policy "members receive map changes" on realtime.messages
  for select to authenticated
  using (
    (select public.current_user_role()) is not null
    and (select realtime.topic()) = 'map-changes'
    and extension = 'broadcast'
  );
