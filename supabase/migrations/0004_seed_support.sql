-- Changes needed to load data/source/seed_interventions.csv.

-- ---------------------------------------------------------------------------
-- Lookups
-- ---------------------------------------------------------------------------

-- In the source data, but not listed in the spec.
insert into public.programs (code, name, sort_order) values
  ('urban', 'National Urban and Peri-Urban Agriculture Program', 6);

-- Categories now come from the CSV (scripts/seed-interventions.ts) in place of the spec's
-- starting list. This fails if any record already uses a category, which is the safe outcome.
delete from public.categories;

-- ---------------------------------------------------------------------------
-- Interventions: source traceability and raw values
-- ---------------------------------------------------------------------------

alter table public.interventions
  add column source_id        text unique,  -- e.g. RAED-2026-10-21-001; null for records entered in the app
  add column source_page      integer,      -- page of the source PDF
  add column category_variant text,         -- e.g. Pull type, Walk-behind
  add column municipality_raw text,
  add column barangay_raw     text,
  add column latitude_raw     text,
  add column longitude_raw    text;

-- Records whose barangay is blank or unrecognised are kept and flagged, never dropped.
-- A null barangay_id passes the composite foreign key to barangays.
alter table public.interventions alter column barangay_id drop not null;

alter table public.interventions drop constraint interventions_qa_flags_check;
alter table public.interventions add constraint interventions_qa_flags_check check (
  qa_flags <@ array[
    'no_coords',
    'out_of_province',
    'muni_mismatch',
    'duplicate_point',
    'no_barangay',
    'barangay_unmatched',
    'beneficiary_name_check'
  ]::text[]
);

-- ---------------------------------------------------------------------------
-- QA trigger
-- ---------------------------------------------------------------------------

-- Replaces the version in 0001. Differences:
--   * adds no_barangay and barangay_unmatched
--   * the municipality check runs on every located record, including out-of-province ones
--   * keeps manual review flags, which nothing here can compute. All other flags are
--     always recalculated, so values supplied by a caller are ignored.
create or replace function public.interventions_before_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  flags text[] := '{}';
  manual_flags text[] := array(
    select flag from unnest(new.qa_flags) as flag where flag = 'beneficiary_name_check'
  );
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
    end if;

    -- The 250 m tolerance stops points on the shore or a simplified border raising false alarms.
    select boundary into selected_boundary
    from public.municipalities
    where id = new.municipality_id;

    if selected_boundary is not null
      and not ST_DWithin(selected_boundary::geography, point::geography, 250) then
      flags := array_append(flags, 'muni_mismatch');
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

  if new.barangay_id is null then
    if nullif(trim(new.barangay_raw), '') is null then
      flags := array_append(flags, 'no_barangay');
    else
      flags := array_append(flags, 'barangay_unmatched');
    end if;
  end if;

  new.qa_flags := flags || manual_flags;

  -- Depth above 1 means this is only a flag refresh caused by a neighbouring record.
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1 then
    new.updated_at := now();
  end if;

  return new;
end;
$$;
