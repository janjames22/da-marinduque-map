-- DA Marinduque Intervention Map: baseline schema (spec section 4).
-- 0003_boundaries.sql loads barangays and polygons. 0004_audit_triggers.sql then turns on auditing.
-- Write policies and the Realtime publication arrive with the Supabase switch (Phase 4).

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- System vocabulary: code depends on these, so they are not editable lookups.
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin', 'encoder', 'viewer');
create type public.geometry_kind as enum ('point', 'line', 'polygon');

-- ---------------------------------------------------------------------------
-- Editable lookups. These are archived with is_active, never deleted.
-- ---------------------------------------------------------------------------

create table public.icons (
  id        smallint generated always as identity primary key,
  name      text not null unique,
  image     text not null,  -- SVG markup; exports convert it to PNG
  is_active boolean not null default true
);

create table public.programs (
  id         smallint generated always as identity primary key,
  code       text not null unique,
  name       text not null unique,
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order smallint not null default 0,
  is_active  boolean not null default true
);

create table public.category_groups (
  id         smallint generated always as identity primary key,
  code       text not null unique,
  name       text not null unique,
  sort_order smallint not null default 0
);

create table public.statuses (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order smallint not null default 0,
  is_active  boolean not null default true
);

create table public.beneficiary_types (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  sort_order smallint not null default 0,
  is_active  boolean not null default true
);

-- What a record's coordinates actually mark.
create table public.location_bases (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order smallint not null default 0,
  is_active  boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Field schemas: custom fields for intervention types and barangay baselines
-- ---------------------------------------------------------------------------

create function public.validate_field_schema(schema jsonb)
returns void
language plpgsql
immutable
as $$
declare
  field jsonb;
  field_key text;
  input text;
  seen text[] := '{}';
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

    if coalesce(field ->> 'label', '') = '' then
      raise exception 'field % needs a label', field_key using errcode = 'check_violation';
    end if;
    if input is null or input not in ('text', 'number', 'date', 'dropdown', 'yes_no', 'photo') then
      raise exception 'field % has invalid input kind: %', field_key, coalesce(input, '(none)')
        using errcode = 'check_violation';
    end if;
    if input = 'dropdown' and (
      jsonb_typeof(field -> 'options') is distinct from 'array' or jsonb_array_length(field -> 'options') = 0
    ) then
      raise exception 'dropdown field % needs options', field_key using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

-- Fields and options are archived, never removed, so existing values keep their meaning.
create function public.check_field_schema_change(old_schema jsonb, new_schema jsonb)
returns void
language plpgsql
immutable
as $$
declare
  old_field jsonb;
  new_field jsonb;
  old_option jsonb;
begin
  for old_field in select value from jsonb_array_elements(old_schema -> 'fields') loop
    select value into new_field
    from jsonb_array_elements(new_schema -> 'fields')
    where value ->> 'key' = old_field ->> 'key';

    if new_field is null then
      raise exception 'field % cannot be removed; archive it instead', old_field ->> 'key'
        using errcode = 'check_violation';
    end if;
    if new_field ->> 'input' <> old_field ->> 'input' then
      raise exception 'field % cannot change its input kind', old_field ->> 'key'
        using errcode = 'check_violation';
    end if;

    for old_option in select value from jsonb_array_elements(coalesce(old_field -> 'options', '[]'::jsonb)) loop
      if not exists (
        select 1 from jsonb_array_elements(new_field -> 'options') option
        where option.value ->> 'value' = old_option ->> 'value'
      ) then
        raise exception 'option % of field % cannot be removed; archive it instead',
          old_option ->> 'value', old_field ->> 'key'
          using errcode = 'check_violation';
      end if;
    end loop;
  end loop;
end;
$$;

create function public.validate_attributes(schema jsonb, attrs jsonb)
returns void
language plpgsql
immutable
as $$
declare
  field jsonb;
  field_key text;
  input text;
  attr_key text;
  val jsonb;
begin
  if jsonb_typeof(attrs) is distinct from 'object' then
    raise exception 'attributes must be a JSON object' using errcode = 'check_violation';
  end if;

  for attr_key in select jsonb_object_keys(attrs) loop
    if not exists (
      select 1 from jsonb_array_elements(schema -> 'fields') f where f.value ->> 'key' = attr_key
    ) then
      raise exception 'unknown field: %', attr_key using errcode = 'check_violation';
    end if;
  end loop;

  for field in select value from jsonb_array_elements(schema -> 'fields') loop
    field_key := field ->> 'key';
    input := field ->> 'input';
    val := attrs -> field_key;

    if val is null or jsonb_typeof(val) = 'null' then
      if coalesce((field ->> 'required')::boolean, false) and not coalesce((field ->> 'archived')::boolean, false) then
        raise exception 'field % is required', field_key using errcode = 'check_violation';
      end if;
      continue;
    end if;

    if input in ('text', 'photo') and jsonb_typeof(val) <> 'string'
      or input = 'number' and jsonb_typeof(val) <> 'number'
      or input = 'yes_no' and jsonb_typeof(val) <> 'boolean' then
      raise exception 'field % must be of kind %', field_key, input using errcode = 'check_violation';
    end if;

    if input = 'date' then
      begin
        if jsonb_typeof(val) <> 'string' or val #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'bad format';
        end if;
        perform (val #>> '{}')::date;
      exception when others then
        raise exception 'field % must be a date (YYYY-MM-DD)', field_key using errcode = 'check_violation';
      end;
    end if;

    if input = 'dropdown' and not exists (
      select 1 from jsonb_array_elements(field -> 'options') option
      where option.value ->> 'value' = val #>> '{}'
    ) then
      raise exception 'field % has an invalid option: %', field_key, val #>> '{}' using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Intervention types (admin-defined)
-- ---------------------------------------------------------------------------

create table public.intervention_types (
  id               smallint generated always as identity primary key,
  code             text not null unique,
  name             text not null unique,
  geometry_kind    public.geometry_kind not null,
  icon_id          smallint references public.icons (id),
  color            text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Standard interventions columns mapped to required, optional or hidden.
  core_field_rules jsonb not null default '{}',
  field_schema     jsonb not null default '{"fields": []}',
  sort_order       smallint not null default 0,
  is_active        boolean not null default true
);

create table public.intervention_type_statuses (
  intervention_type_id  smallint not null references public.intervention_types (id),
  status_id             smallint not null references public.statuses (id),
  sort_order            smallint not null default 0,
  is_default            boolean not null default false,
  counts_as_operational boolean not null default false,
  primary key (intervention_type_id, status_id)
);

create unique index intervention_type_statuses_one_default
  on public.intervention_type_statuses (intervention_type_id) where is_default;

create table public.categories (
  id                   smallint generated always as identity primary key,
  code                 text not null unique,
  name                 text not null unique,
  intervention_type_id smallint references public.intervention_types (id),  -- null means any type
  category_group_id    smallint references public.category_groups (id),
  icon_id              smallint references public.icons (id),
  sort_order           smallint not null default 0,
  is_active            boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

create table public.municipalities (
  id        smallint generated always as identity primary key,
  name      text not null unique,
  psgc_code text unique,
  boundary  extensions.geometry(MultiPolygon, 4326)
);

create table public.barangays (
  id              integer generated always as identity primary key,
  municipality_id smallint not null references public.municipalities (id),
  name            text not null,
  psgc_code       text unique,
  boundary        extensions.geometry(MultiPolygon, 4326),
  attributes      jsonb not null default '{}',  -- baseline values, per barangay_field_schema
  unique (municipality_id, name),
  unique (municipality_id, id)  -- target of the composite foreign key below
);

create index municipalities_boundary_idx on public.municipalities using gist (boundary);
create index barangays_boundary_idx on public.barangays using gist (boundary);

-- One admin-editable schema, shared by all barangays.
create table public.barangay_field_schema (
  id           boolean primary key default true check (id),
  field_schema jsonb not null default '{"fields": []}'
);

-- ---------------------------------------------------------------------------
-- People and imports
-- ---------------------------------------------------------------------------

-- A row here is what makes someone a member. Accounts in auth.users without a
-- profile can sign in but read nothing, so an accidental public sign-up exposes no data.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  role       public.user_role not null default 'viewer',
  created_at timestamptz not null default now()
);

create table public.import_batches (
  id                   uuid primary key default gen_random_uuid(),
  file_name            text not null,
  data_source          text not null,
  intervention_type_id smallint references public.intervention_types (id),
  column_mapping       jsonb not null default '{}',
  counts               jsonb not null default '{}',
  imported_by          uuid default auth.uid() references public.profiles (id),
  imported_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Interventions
-- ---------------------------------------------------------------------------

create table public.interventions (
  id                   uuid primary key default gen_random_uuid(),
  intervention_type_id smallint not null references public.intervention_types (id),
  category_id          smallint references public.categories (id),
  title                text,
  banner_program_id    smallint references public.programs (id),
  year_funded          integer check (year_funded >= 2000),
  quantity             integer not null default 1 check (quantity > 0),
  unit_cost            numeric(14, 2) check (unit_cost >= 0),
  fund_source          text,
  beneficiary          text,
  beneficiary_type_id  smallint references public.beneficiary_types (id),
  municipality_id      smallint not null references public.municipalities (id),
  barangay_id          integer,          -- primary barangay; null means unassigned, and is flagged
  barangay_raw         text,             -- as written in the source
  location_basis_id    smallint references public.location_bases (id),
  geom                 extensions.geometry(Geometry, 4326),  -- null means unlocated
  status_id            smallint references public.statuses (id),  -- maintained from status_history
  attributes           jsonb not null default '{}',  -- custom fields, per the type's field_schema
  remarks              text,
  data_source          text,
  import_batch_id      uuid references public.import_batches (id),
  source_id            text,
  source_page          integer,
  source_raw           jsonb,            -- the complete source row, for any dataset
  qa_flags             text[] not null default '{}' check (
    qa_flags <@ array[
      'no_coords',
      'out_of_province',
      'muni_mismatch',
      'barangay_mismatch',
      'duplicate_point',
      'no_barangay',
      'barangay_unmatched',
      'beneficiary_name_check'
    ]::text[]
  ),
  version              integer not null default 1,  -- stops two users overwriting each other's edits
  created_by           uuid default auth.uid() references public.profiles (id),
  updated_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,      -- soft delete; restorable

  unique (data_source, source_id),
  -- A barangay must belong to the record's municipality. A null barangay passes this.
  foreign key (municipality_id, barangay_id) references public.barangays (municipality_id, id),
  -- A record needs something to be called.
  check (title is not null or category_id is not null)
);

create index interventions_geom_idx on public.interventions using gist (geom);
create index interventions_type_idx on public.interventions (intervention_type_id);
create index interventions_municipality_idx on public.interventions (municipality_id);
create index interventions_barangay_idx on public.interventions (barangay_id);

-- Every barangay a record belongs to, so a road crossing three appears in all three profiles.
create table public.intervention_barangays (
  intervention_id uuid not null references public.interventions (id) on delete cascade,
  barangay_id     integer not null references public.barangays (id),
  link_source     text not null check (link_source in ('encoded', 'spatial')),
  primary key (intervention_id, barangay_id)
);

create index intervention_barangays_barangay_idx on public.intervention_barangays (barangay_id);

create table public.intervention_photos (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions (id) on delete cascade,
  storage_path    text not null,
  caption         text,
  taken_at        timestamptz,
  exif_location   extensions.geometry(Point, 4326),
  created_by      uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);

-- Entries are added, never overwritten. interventions.status_id caches the current one.
create table public.status_history (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions (id) on delete cascade,
  status_id       smallint not null references public.statuses (id),
  status_date     date not null default current_date,
  -- 'changed': the status changed on this date. 'as_of': it was reported this way on this date,
  -- and may have changed earlier. The UI shows the second as "as of <date> (<source_note>)".
  date_basis      text not null default 'changed' check (date_basis in ('changed', 'as_of')),
  source_note     text,
  remarks         text,
  photo_id        uuid references public.intervention_photos (id),
  created_by      uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default clock_timestamp()
);

create index status_history_intervention_idx on public.status_history (intervention_id, status_date desc);

create table public.saved_views (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null default auth.uid() references public.profiles (id),
  config     jsonb not null default '{}',  -- layers, filters, style, extent, basemap
  is_shared  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  text,
  action     text not null check (action in ('insert', 'update', 'delete', 'soft_delete', 'restore')),
  old_row    jsonb,
  new_row    jsonb,
  actor_id   uuid,
  context    jsonb,  -- extra detail, such as the evidence behind a correction
  at         timestamptz not null default clock_timestamp()
);

create index audit_log_record_idx on public.audit_log (table_name, record_id);

-- ---------------------------------------------------------------------------
-- Triggers: schema checks
-- ---------------------------------------------------------------------------

create function public.intervention_types_before_write()
returns trigger
language plpgsql
as $$
declare
  rule record;
begin
  perform public.validate_field_schema(new.field_schema);

  for rule in select key, value #>> '{}' as val from jsonb_each(new.core_field_rules) loop
    if rule.val not in ('required', 'optional', 'hidden') then
      raise exception 'invalid rule for %: %', rule.key, rule.val using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    perform public.check_field_schema_change(old.field_schema, new.field_schema);

    if new.geometry_kind <> old.geometry_kind and exists (
      select 1 from public.interventions where intervention_type_id = new.id
    ) then
      raise exception 'geometry kind cannot change once a type has records' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger intervention_types_before_write
before insert or update on public.intervention_types
for each row execute function public.intervention_types_before_write();

create function public.barangay_field_schema_before_write()
returns trigger
language plpgsql
as $$
begin
  perform public.validate_field_schema(new.field_schema);
  if tg_op = 'UPDATE' then
    perform public.check_field_schema_change(old.field_schema, new.field_schema);
  end if;
  return new;
end;
$$;

create trigger barangay_field_schema_before_write
before insert or update on public.barangay_field_schema
for each row execute function public.barangay_field_schema_before_write();

create function public.barangays_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.attributes is distinct from old.attributes then
    perform public.validate_attributes(
      (select field_schema from public.barangay_field_schema where id),
      new.attributes
    );
  end if;
  return new;
end;
$$;

create trigger barangays_before_update
before update on public.barangays
for each row execute function public.barangays_before_update();

-- ---------------------------------------------------------------------------
-- Triggers: interventions
-- ---------------------------------------------------------------------------

-- Thresholds are mirrored by the browser validator in Phase 3.
create function public.interventions_before_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  is_user_write boolean := pg_trigger_depth() = 1;  -- deeper means another trigger caused this
  type_row public.intervention_types;
  rule record;
  new_row jsonb;
  old_row jsonb;
  category_type smallint;
  flags text[] := '{}';
  -- Manual review flags are kept. All others are recalculated, so caller values are ignored.
  manual_flags text[] := array(
    select flag from unnest(new.qa_flags) as flag where flag = 'beneficiary_name_check'
  );
  municipality_boundary extensions.geometry;
  barangay_boundary extensions.geometry;
begin
  -- status_id is only ever set from status_history; version and updated_at from here.
  if tg_op = 'INSERT' then
    new.status_id := null;
  elsif is_user_write then
    new.status_id := old.status_id;
    new.version := old.version + 1;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;

  -- The source uses 0,0 for "no coordinates". A single zero stays visible as out_of_province.
  if new.geom is not null and GeometryType(new.geom) = 'POINT' and ST_X(new.geom) = 0 and ST_Y(new.geom) = 0 then
    new.geom := null;
  end if;

  if is_user_write then
    select * into type_row from public.intervention_types where id = new.intervention_type_id;

    if new.year_funded > extract(year from now() at time zone 'Asia/Manila') then
      raise exception 'year_funded % is in the future', new.year_funded using errcode = 'check_violation';
    end if;

    if new.category_id is not null then
      select intervention_type_id into category_type from public.categories where id = new.category_id;
      if category_type is not null and category_type <> new.intervention_type_id then
        raise exception 'category does not belong to intervention type %', type_row.name
          using errcode = 'check_violation';
      end if;
    end if;

    if new.geom is not null then
      if not ST_IsValid(new.geom) then
        raise exception 'geometry is not valid' using errcode = 'check_violation';
      end if;
      if not (
        type_row.geometry_kind = 'point' and GeometryType(new.geom) = 'POINT'
        or type_row.geometry_kind = 'line' and GeometryType(new.geom) in ('LINESTRING', 'MULTILINESTRING')
        or type_row.geometry_kind = 'polygon' and GeometryType(new.geom) in ('POLYGON', 'MULTIPOLYGON')
      ) then
        raise exception 'type % needs a % geometry, not %', type_row.name, type_row.geometry_kind, GeometryType(new.geom)
          using errcode = 'check_violation';
      end if;
    end if;

    -- A newly required field shouldn't stop existing records being moved, so these
    -- checks only run when the values concerned change.
    if tg_op = 'INSERT' or new.attributes is distinct from old.attributes
      or new.intervention_type_id <> old.intervention_type_id then
      perform public.validate_attributes(type_row.field_schema, new.attributes);
    end if;

    new_row := to_jsonb(new);
    old_row := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    for rule in select key, value #>> '{}' as val from jsonb_each(type_row.core_field_rules) loop
      if rule.val = 'required' and new_row ->> rule.key is null and (
        tg_op = 'INSERT' or old_row ->> rule.key is not null or new.intervention_type_id <> old.intervention_type_id
      ) then
        raise exception '% is required for type %', rule.key, type_row.name using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  -- QA flags
  if new.geom is null then
    flags := array_append(flags, 'no_coords');
  else
    if ST_XMin(new.geom) < 121.78 or ST_XMax(new.geom) > 122.20
      or ST_YMin(new.geom) < 13.15 or ST_YMax(new.geom) > 13.60 then
      flags := array_append(flags, 'out_of_province');
    end if;

    -- The 250 m tolerance stops points on the shore or a simplified border raising false alarms.
    select boundary into municipality_boundary from public.municipalities where id = new.municipality_id;
    if municipality_boundary is not null
      and not ST_DWithin(municipality_boundary::geography, new.geom::geography, 250) then
      flags := array_append(flags, 'muni_mismatch');
    end if;

    if new.barangay_id is not null then
      select boundary into barangay_boundary from public.barangays where id = new.barangay_id;
      if barangay_boundary is not null
        and not ST_DWithin(barangay_boundary::geography, new.geom::geography, 250) then
        flags := array_append(flags, 'barangay_mismatch');
      end if;
    end if;

    if GeometryType(new.geom) = 'POINT' and new.deleted_at is null and exists (
      select 1 from public.interventions other
      where other.geom ~= new.geom and other.deleted_at is null and other.id <> new.id
    ) then
      flags := array_append(flags, 'duplicate_point');
    end if;
  end if;

  if new.barangay_id is null then
    if nullif(trim(new.barangay_raw), '') is null then
      flags := array_append(flags, 'no_barangay');
    else
      flags := array_append(flags, 'barangay_unmatched');
    end if;
  end if;

  new.qa_flags := flags || manual_flags;
  return new;
end;
$$;

create trigger interventions_before_write
before insert or update on public.interventions
for each row execute function public.interventions_before_write();

-- When a record arrives at, leaves or is deleted from a point, the other records there need
-- duplicate_point recalculated. Touching them re-runs the trigger above.
create function public.interventions_refresh_neighbours()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.geom is not null and GeometryType(old.geom) = 'POINT' then
    update public.interventions set qa_flags = qa_flags
    where geom ~= old.geom and id <> old.id and deleted_at is null;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.geom is not null and GeometryType(new.geom) = 'POINT' then
    update public.interventions set qa_flags = qa_flags
    where geom ~= new.geom and id <> new.id and deleted_at is null;
  end if;

  return null;
end;
$$;

create trigger interventions_refresh_neighbours
after insert or delete or update of geom, deleted_at on public.interventions
for each row execute function public.interventions_refresh_neighbours();

-- Points belong to their encoded barangay. Lines and polygons also belong to every barangay they cross.
create function public.interventions_sync_barangays()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from public.intervention_barangays where intervention_id = new.id;

  if new.barangay_id is not null then
    insert into public.intervention_barangays (intervention_id, barangay_id, link_source)
    values (new.id, new.barangay_id, 'encoded');
  end if;

  if new.geom is not null and GeometryType(new.geom) <> 'POINT' then
    insert into public.intervention_barangays (intervention_id, barangay_id, link_source)
    select new.id, b.id, 'spatial'
    from public.barangays b
    where ST_Intersects(b.boundary, new.geom)
    on conflict (intervention_id, barangay_id) do nothing;
  end if;

  return null;
end;
$$;

create trigger interventions_sync_barangays
after insert or update of geom, barangay_id on public.interventions
for each row execute function public.interventions_sync_barangays();

-- ---------------------------------------------------------------------------
-- Triggers: status history
-- ---------------------------------------------------------------------------

create function public.status_history_before_insert()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.interventions i
    join public.intervention_type_statuses s on s.intervention_type_id = i.intervention_type_id
    where i.id = new.intervention_id and s.status_id = new.status_id
  ) then
    raise exception 'status is not in the status list for this type' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger status_history_before_insert
before insert on public.status_history
for each row execute function public.status_history_before_insert();

-- The current status is the entry with the latest date. A backdated entry doesn't replace it.
create function public.status_history_refresh_current()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := coalesce(new.intervention_id, old.intervention_id);
begin
  update public.interventions
  set status_id = (
        select status_id from public.status_history
        where intervention_id = target
        order by status_date desc, created_at desc
        limit 1
      ),
      updated_at = now()
  where id = target;
  return null;
end;
$$;

create trigger status_history_refresh_current
after insert or update or delete on public.status_history
for each row execute function public.status_history_refresh_current();

-- ---------------------------------------------------------------------------
-- Read model: GeoJSON geometry and the barangay a record is actually plotted in
-- ---------------------------------------------------------------------------

create view public.interventions_v
with (security_invoker = true)
as
select
  i.*,
  ST_AsGeoJSON(i.geom)::jsonb as geojson,
  plotted.id as plotted_barangay_id,
  plotted.name as plotted_barangay,
  plotted.municipality as plotted_municipality
from public.interventions i
left join lateral (
  select b.id, b.name, m.name as municipality
  from public.barangays b
  join public.municipalities m on m.id = b.municipality_id
  where b.boundary && ST_Expand(ST_PointOnSurface(i.geom), 0.003)
    and ST_DWithin(b.boundary::geography, ST_PointOnSurface(i.geom)::geography, 250)
  order by ST_Distance(b.boundary, ST_PointOnSurface(i.geom)), b.id
  limit 1
) plotted on true;

-- ---------------------------------------------------------------------------
-- Row-level security: members can read. Write policies arrive in Phase 4.
-- ---------------------------------------------------------------------------

create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'icons', 'programs', 'category_groups', 'statuses', 'beneficiary_types', 'location_bases',
    'intervention_types', 'intervention_type_statuses', 'categories',
    'municipalities', 'barangays', 'barangay_field_schema',
    'import_batches', 'intervention_barangays', 'intervention_photos', 'status_history'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy "members read" on public.%I for select to authenticated using (public.current_user_role() is not null)',
      table_name
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;
create policy "users read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

alter table public.interventions enable row level security;
create policy "members read interventions" on public.interventions
  for select to authenticated using (public.current_user_role() is not null and deleted_at is null);

alter table public.saved_views enable row level security;
create policy "members read own and shared views" on public.saved_views
  for select to authenticated using (
    public.current_user_role() is not null and (owner_id = auth.uid() or is_shared)
  );

alter table public.audit_log enable row level security;
create policy "admins read audit log" on public.audit_log
  for select to authenticated using (public.current_user_role() = 'admin');

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Starting lookups (spec sections 4.1, 4.7, 4.8 and 12). Admins can edit all of these.
-- The RAED categories are added by scripts/seed-interventions.ts.
-- ---------------------------------------------------------------------------

insert into public.municipalities (name) values
  ('Boac'), ('Buenavista'), ('Gasan'), ('Mogpog'), ('Santa Cruz'), ('Torrijos');

insert into public.barangay_field_schema (field_schema) values ('{"fields": [
  {"key": "agricultural_area_ha", "label": "Agricultural area", "input": "number", "unit": "ha"},
  {"key": "farmer_count", "label": "Number of farmers", "input": "number"},
  {"key": "main_crops", "label": "Main crops", "input": "text"},
  {"key": "irrigated_area_ha", "label": "Irrigated area", "input": "number", "unit": "ha"},
  {"key": "remarks", "label": "Remarks", "input": "text"}
]}');

insert into public.programs (code, name, color, sort_order) values
  ('rice',      'Rice Program',                                      '#2e7d32', 1),
  ('corn',      'Corn Program',                                      '#f59e0b', 2),
  ('hvcdp',     'High Value Crop Development Program',               '#7b1fa2', 3),
  ('livestock', 'National Livestock Program',                        '#795548', 4),
  ('organic',   'National Organic Agriculture Program',              '#00897b', 5),
  ('urban',     'National Urban and Peri-Urban Agriculture Program', '#d81b60', 6);

insert into public.category_groups (code, name, sort_order) values
  ('land_preparation', 'Land preparation', 1),
  ('planting',         'Planting',         2),
  ('crop_care',        'Crop care',        3),
  ('harvesting',       'Harvesting',       4),
  ('postharvest',      'Postharvest',      5),
  ('processing',       'Processing',       6),
  ('irrigation',       'Irrigation',       7),
  ('other',            'Other',            8);

insert into public.beneficiary_types (name, sort_order) values
  ('FCA', 1), ('Cooperative', 2), ('LGU', 3), ('PLGU', 4), ('Individual', 5);

insert into public.location_bases (name, color, sort_order) values
  ('Actual unit/structure location', '#2e7d32', 1),
  ('FCA office/storage',             '#1976d2', 2),
  ('Barangay center (approximate)',  '#f59e0b', 3),
  ('Unknown',                        '#9e9e9e', 4);

insert into public.statuses (name, color, sort_order) values
  ('Turned-over',                  '#2e7d32', 1),
  ('Serviceable',                  '#43a047', 2),
  ('Needs Repair',                 '#f59e0b', 3),
  ('Unserviceable',                '#d32f2f', 4),
  ('For Condemnation',             '#8e0000', 5),
  ('Undelivered/For Distribution', '#5c6bc0', 6),
  ('Proposed',                     '#90a4ae', 7),
  ('Inventory',                    '#546e7a', 8),
  ('On-going',                     '#1976d2', 9),
  ('Completed',                    '#00897b', 10),
  ('Operational',                  '#2e7d32', 11),
  ('Non-operational',              '#d32f2f', 12),
  ('Unknown',                      '#9e9e9e', 13);

insert into public.icons (name, image) values
  ('Pin',      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/></svg>'),
  ('Gear',     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 5.5v-3l-2.3-.5-.7-1.7 1.3-2-2.1-2.1-2 1.3-1.7-.7-.5-2.3h-3l-.5 2.3-1.7.7-2-1.3-2.1 2.1 1.3 2-.7 1.7-2.3.5v3l2.3.5.7 1.7-1.3 2 2.1 2.1 2-1.3 1.7.7.5 2.3h3l.5-2.3 1.7-.7 2 1.3 2.1-2.1-1.3-2 .7-1.7z"/></svg>'),
  ('Sun',      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M4.2 19.8 7 17M17 7l2.8-2.8" stroke="currentColor" stroke-width="2"/></svg>'),
  ('Water',    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z"/></svg>'),
  ('Building', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 21V9l9-6 9 6v12h-6v-7H9v7z"/></svg>'),
  ('Road',     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 2h3v4h2V2h3l4 20h-7v-5h-2v5H4zm3 7v5h2V9z"/></svg>'),
  ('Canal',    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 8c3-3 5-3 8 0s5 3 8 0l4-2v4l-4 2c-3 3-5 3-8 0s-5-3-8 0zm0 7c3-3 5-3 8 0s5 3 8 0l4-2v4l-4 2c-3 3-5 3-8 0s-5-3-8 0z"/></svg>'),
  ('Area',     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 5l14-2 3 13-12 5-6-6zm3 2 .3 7 2.6 3 8-3.300L16.300 6z"/></svg>');

insert into public.intervention_types (code, name, geometry_kind, icon_id, color, sort_order, core_field_rules, field_schema) values
  ('farm-machinery', 'Farm Machinery', 'point', (select id from public.icons where name = 'Gear'), '#2e7d32', 1,
   '{"category_id": "required", "banner_program_id": "required", "year_funded": "required", "beneficiary": "required"}',
   '{"fields": [
     {"key": "variant", "label": "Variant", "input": "text"},
     {"key": "serial_no", "label": "Serial No.", "input": "text"},
     {"key": "engine_no", "label": "Engine No.", "input": "text"},
     {"key": "date_turned_over", "label": "Date turned over", "input": "date"}
   ]}'),
  ('ssip', 'SSIP', 'point', (select id from public.icons where name = 'Water'), '#1976d2', 2,
   '{"category_id": "required", "year_funded": "required"}',
   '{"fields": [
     {"key": "water_source", "label": "Water source", "input": "text"},
     {"key": "service_area_ha", "label": "Service area", "input": "number", "unit": "ha"},
     {"key": "farmer_beneficiaries", "label": "Farmer-beneficiaries", "input": "number", "unit": "no."},
     {"key": "pump_capacity", "label": "Pump capacity", "input": "text"},
     {"key": "solar_capacity_kwp", "label": "Solar capacity", "input": "number", "unit": "kWp"}
   ]}'),
  ('fmr', 'Farm-to-Market Road', 'line', (select id from public.icons where name = 'Road'), '#6d4c41', 3,
   '{"title": "required"}',
   '{"fields": [
     {"key": "length_km", "label": "Length", "input": "number", "unit": "km"},
     {"key": "width_m", "label": "Width", "input": "number", "unit": "m"}
   ]}'),
  ('postharvest-facility', 'Postharvest Facility', 'point', (select id from public.icons where name = 'Building'), '#ef6c00', 4,
   '{"title": "required"}',
   '{"fields": [{"key": "floor_area_sqm", "label": "Floor area", "input": "number", "unit": "sq m"}]}'),
  ('irrigation-canal', 'Irrigation Canal', 'line', (select id from public.icons where name = 'Canal'), '#00acc1', 5,
   '{"title": "required"}',
   '{"fields": [{"key": "length_km", "label": "Length", "input": "number", "unit": "km"}]}'),
  ('service-area', 'Service Area', 'polygon', (select id from public.icons where name = 'Area'), '#7cb342', 6,
   '{"title": "required"}',
   '{"fields": [{"key": "area_ha", "label": "Area", "input": "number", "unit": "ha"}]}'),
  ('other', 'Other', 'point', (select id from public.icons where name = 'Pin'), '#757575', 7,
   '{"title": "required"}',
   '{"fields": []}');

-- Only these are in use for now. The rest stay hidden until an admin activates them.
update public.intervention_types set is_active = false where code not in ('farm-machinery', 'ssip');

-- Status lists per type. Which statuses count as operational is set per type.
insert into public.intervention_type_statuses (intervention_type_id, status_id, sort_order, is_default, counts_as_operational)
select t.id, s.id, list.sort_order, list.is_default, list.counts_as_operational
from (values
  ('Turned-over',                  1, true,  true),
  ('Serviceable',                  2, false, true),
  ('Needs Repair',                 3, false, false),
  ('Unserviceable',                4, false, false),
  ('For Condemnation',             5, false, false),
  ('Undelivered/For Distribution', 6, false, false),
  ('Unknown',                      7, false, false)
) as list (status_name, sort_order, is_default, counts_as_operational)
join public.statuses s on s.name = list.status_name
join public.intervention_types t on t.code = 'farm-machinery';

insert into public.intervention_type_statuses (intervention_type_id, status_id, sort_order, is_default, counts_as_operational)
select t.id, s.id, list.sort_order, list.is_default, list.counts_as_operational
from (values
  ('Inventory',       1, true,  false),
  ('On-going',        2, false, false),
  ('Completed',       3, false, false),
  ('Operational',     4, false, true),
  ('Needs Repair',    5, false, false),
  ('Non-operational', 6, false, false)
) as list (status_name, sort_order, is_default, counts_as_operational)
join public.statuses s on s.name = list.status_name
join public.intervention_types t on t.code = 'ssip';

insert into public.intervention_type_statuses (intervention_type_id, status_id, sort_order, is_default, counts_as_operational)
select t.id, s.id, list.sort_order, list.is_default, list.counts_as_operational
from (values
  ('Proposed',        1, true,  false),
  ('On-going',        2, false, false),
  ('Completed',       3, false, false),
  ('Operational',     4, false, true),
  ('Needs Repair',    5, false, false),
  ('Non-operational', 6, false, false),
  ('Unknown',         7, false, false)
) as list (status_name, sort_order, is_default, counts_as_operational)
join public.statuses s on s.name = list.status_name
join public.intervention_types t on t.code in ('fmr', 'postharvest-facility', 'irrigation-canal', 'service-area', 'other');

insert into public.categories (code, name, intervention_type_id, category_group_id, sort_order)
select list.code, list.name, t.id, g.id, list.sort_order
from (values
  ('disc-plow-harrow', 'Disc Plow / Harrow',                     'farm-machinery', 'land_preparation', 1),
  ('seeder',           'Seeder',                                 'farm-machinery', 'planting',         2),
  ('rice-reaper',      'Rice Reaper',                            'farm-machinery', 'harvesting',       3),
  ('spis',             'Solar-Powered Irrigation System (SPIS)', 'ssip',           'irrigation',       4),
  ('sfr',              'Small Farm Reservoir (SFR)',             'ssip',           'irrigation',       5),
  ('stw',              'Shallow Tube Well (STW)',                'ssip',           'irrigation',       6),
  ('pisos',            'Pump Irrigation from Open Source (PISOS)', 'ssip',         'irrigation',       7),
  ('swip',             'Small Water Impounding Project (SWIP)',  'ssip',           'irrigation',       8),
  ('diversion-dam',    'Diversion Dam',                          'ssip',           'irrigation',       9),
  -- Applies to any type, including SSIP.
  ('other',            'Other',                                  null,             'other',            10)
) as list (code, name, type_code, group_code, sort_order)
join public.category_groups g on g.code = list.group_code
left join public.intervention_types t on t.code = list.type_code;
