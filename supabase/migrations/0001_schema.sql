-- DA Marinduque Intervention Map: core schema (spec section 4).
-- Later migrations add write policies, photos, the audit log and realtime (Phase 5).

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.intervention_type as enum ('machinery', 'spis', 'ssip', 'fmr', 'other');

-- 'Unknown' is an addition to section 4.4: the SPIS source table has no status
-- column, and the grey "unknown" map style needs a value to attach to.
create type public.intervention_status as enum (
  'Turned-over',
  'Serviceable',
  'Needs Repair',
  'Unserviceable',
  'For Condemnation',
  'Undelivered/For Distribution',
  'Unknown'
);

create type public.project_stage as enum ('Proposed', 'Inventory', 'On-going', 'Completed');

create type public.beneficiary_type as enum ('FCA', 'Cooperative', 'LGU', 'PLGU', 'Individual');

create type public.user_role as enum ('admin', 'encoder', 'viewer');

create type public.category_group as enum (
  'land_preparation',
  'planting',
  'crop_care',
  'harvesting',
  'postharvest',
  'processing',
  'irrigation',
  'other'
);

-- ---------------------------------------------------------------------------
-- Lookups
-- ---------------------------------------------------------------------------

create table public.programs (
  id         smallint generated always as identity primary key,
  code       text not null unique,  -- stable key used by colours and KML style ids
  name       text not null unique,
  sort_order smallint not null default 0
);

create table public.categories (
  id         smallint generated always as identity primary key,
  code       text not null unique,  -- also the icon name
  name       text not null unique,
  group_code public.category_group not null,
  sort_order smallint not null default 0
);

create table public.municipalities (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  psgc_code  text unique,
  boundary   extensions.geometry(MultiPolygon, 4326)
);

create table public.barangays (
  id              integer generated always as identity primary key,
  municipality_id smallint not null references public.municipalities (id),
  name            text not null,
  psgc_code       text unique,
  boundary        extensions.geometry(MultiPolygon, 4326),
  unique (municipality_id, name),
  unique (municipality_id, id)  -- target of the composite foreign key below
);

create index municipalities_boundary_idx on public.municipalities using gist (boundary);
create index barangays_boundary_idx on public.barangays using gist (boundary);

-- A row here is what makes someone a member. Accounts in auth.users without a
-- profile can sign in but read nothing, so an accidental public sign-up exposes no data.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  role       public.user_role not null default 'viewer',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Interventions
-- ---------------------------------------------------------------------------

create table public.interventions (
  id                uuid primary key default gen_random_uuid(),
  intervention_type public.intervention_type not null,
  category_id       smallint not null references public.categories (id),
  name_raw          text not null,   -- exactly as written in the source
  name_display      text,            -- cleaned value shown in the UI
  title             text,            -- project title (SPIS/SSIP)
  banner_program_id smallint not null references public.programs (id),
  year_funded       integer not null check (year_funded >= 2000),
  fund_source       text,
  quantity          integer not null default 1 check (quantity > 0),
  unit_cost         numeric(14, 2) check (unit_cost >= 0),
  beneficiary       text not null,   -- cleaned value; "FCAs served" counts distinct values
  beneficiary_raw   text,            -- exactly as written in the source
  beneficiary_type  public.beneficiary_type,
  municipality_id   smallint not null references public.municipalities (id),
  barangay_id       integer not null,
  latitude          numeric(10, 7) check (latitude between -90 and 90),
  longitude         numeric(10, 7) check (longitude between -180 and 180),
  geom              extensions.geometry(Point, 4326),
  status            public.intervention_status not null,
  stage             public.project_stage,
  date_turned_over  date,
  serial_no         text,
  engine_no         text,
  remarks           text,
  data_source       text,
  qa_flags          text[] not null default '{}' check (
    qa_flags <@ array['no_coords', 'out_of_province', 'muni_mismatch', 'duplicate_point']::text[]
  ),
  created_by        uuid references public.profiles (id),
  updated_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,     -- soft delete; restorable

  -- A barangay must belong to the record's municipality.
  foreign key (municipality_id, barangay_id) references public.barangays (municipality_id, id),
  -- Coordinates are both present or both absent.
  check ((latitude is null) = (longitude is null))
);

create index interventions_geom_idx on public.interventions using gist (geom);
create index interventions_municipality_idx on public.interventions (municipality_id);
create index interventions_coordinates_idx on public.interventions (latitude, longitude);

-- ---------------------------------------------------------------------------
-- Triggers: geometry, QA flags, timestamps
-- ---------------------------------------------------------------------------

-- Thresholds are mirrored by the browser validator in Phase 5.
create function public.interventions_before_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  flags text[] := '{}';
  point extensions.geometry;
  selected_boundary extensions.geometry;
begin
  if new.year_funded > extract(year from now() at time zone 'Asia/Manila') then
    raise exception 'year_funded % is in the future', new.year_funded
      using errcode = 'check_violation';
  end if;

  -- The source uses 0,0 for "no coordinates". Only the exact pair is treated this way;
  -- a single zero is a typo that should stay visible as out_of_province.
  if new.latitude = 0 and new.longitude = 0 then
    new.latitude := null;
    new.longitude := null;
  end if;

  if new.latitude is null or new.longitude is null then
    new.geom := null;
    flags := array_append(flags, 'no_coords');
  else
    point := ST_SetSRID(ST_MakePoint(new.longitude::float8, new.latitude::float8), 4326);
    new.geom := point;

    if new.latitude not between 13.15 and 13.60 or new.longitude not between 121.78 and 122.20 then
      flags := array_append(flags, 'out_of_province');
    else
      -- The 250 m tolerance stops points on the shore or a simplified border raising false alarms.
      select boundary into selected_boundary
      from public.municipalities
      where id = new.municipality_id;

      if selected_boundary is not null
        and not ST_DWithin(selected_boundary::geography, point::geography, 250) then
        flags := array_append(flags, 'muni_mismatch');
      end if;
    end if;

    if new.deleted_at is null and exists (
      select 1
      from public.interventions other
      where other.latitude = new.latitude
        and other.longitude = new.longitude
        and other.deleted_at is null
        and other.id <> new.id
    ) then
      flags := array_append(flags, 'duplicate_point');
    end if;
  end if;

  new.qa_flags := flags;

  -- Depth above 1 means this is only a flag refresh caused by a neighbouring record.
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1 then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger interventions_before_write
before insert or update on public.interventions
for each row execute function public.interventions_before_write();

-- When a record arrives at, leaves or is deleted from a point, the other records at
-- that point need their duplicate_point flag recalculated. Touching them re-runs the
-- trigger above, which keeps all the flag logic in one place.
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

  if tg_op in ('UPDATE', 'DELETE') and old.latitude is not null then
    update public.interventions
    set qa_flags = qa_flags
    where latitude = old.latitude
      and longitude = old.longitude
      and id <> old.id
      and deleted_at is null;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.latitude is not null then
    update public.interventions
    set qa_flags = qa_flags
    where latitude = new.latitude
      and longitude = new.longitude
      and id <> new.id
      and deleted_at is null;
  end if;

  return null;
end;
$$;

create trigger interventions_refresh_neighbours
after insert or delete or update of latitude, longitude, deleted_at on public.interventions
for each row execute function public.interventions_refresh_neighbours();

-- ---------------------------------------------------------------------------
-- Row-level security: members can read. Write policies arrive in Phase 5.
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

alter table public.programs enable row level security;
alter table public.categories enable row level security;
alter table public.municipalities enable row level security;
alter table public.barangays enable row level security;
alter table public.profiles enable row level security;
alter table public.interventions enable row level security;

create policy "members read programs" on public.programs
  for select to authenticated using (public.current_user_role() is not null);
create policy "members read categories" on public.categories
  for select to authenticated using (public.current_user_role() is not null);
create policy "members read municipalities" on public.municipalities
  for select to authenticated using (public.current_user_role() is not null);
create policy "members read barangays" on public.barangays
  for select to authenticated using (public.current_user_role() is not null);
create policy "users read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "members read interventions" on public.interventions
  for select to authenticated using (public.current_user_role() is not null and deleted_at is null);

revoke all on all tables in schema public from anon;
