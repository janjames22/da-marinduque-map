-- Phase 16: line types, starting with Farm-to-Market Roads. A line type can be switched on now that the
-- map draws lines, and a line record can wait for its traced line, as a point record waits for its
-- coordinates: it's counted in every total, flagged no_coords, and kept off the map. Polygons are
-- unchanged, as nothing draws them yet.
--
-- This turns nothing on. The Farm-to-Market Road type stays inactive until an Admin switches it on,
-- so a site still running older screens, which can't show lines, is left as it was.

-- ---------------------------------------------------------------------------
-- Intervention types: only a polygon type waits for drawing tools now
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

  -- Drawing polygons isn't built, so a polygon type can be set up but not switched on. Drop this check
  -- once drawing is.
  if new.is_active and new.geometry_kind = 'polygon' then
    raise exception 'a % type cannot be active until drawing tools are built', new.geometry_kind using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Records: a line can wait for its traced line, a polygon still needs its shape
-- ---------------------------------------------------------------------------

create or replace function public.interventions_need_a_shape()
returns trigger
language plpgsql
as $$
begin
  if new.geom is null and (
    select geometry_kind from public.intervention_types where id = new.intervention_type_id
  ) = 'polygon' then
    raise exception 'a polygon record needs its shape' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
