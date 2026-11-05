-- Every create, edit and delete goes to audit_log. This runs after the starting lookups and
-- boundaries are loaded, so only changes made after setup are recorded.
--
-- A caller can attach detail with: select set_config('app.audit_context', '<json>', true)

create function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  old_data jsonb;
  new_data jsonb;
  action text := lower(tg_op);
begin
  -- Deeper changes are side effects of a write that is already being logged, such as a
  -- neighbouring record's flag refresh or the status cache.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Polygons are large and fixed, so a change to a barangay's baseline values doesn't copy them.
  if tg_op <> 'INSERT' then
    old_data := to_jsonb(old) - 'boundary';
  end if;
  if tg_op <> 'DELETE' then
    new_data := to_jsonb(new) - 'boundary';
  end if;

  if tg_op = 'UPDATE' and new_data ? 'deleted_at' then
    if old_data ->> 'deleted_at' is null and new_data ->> 'deleted_at' is not null then
      action := 'soft_delete';
    elsif old_data ->> 'deleted_at' is not null and new_data ->> 'deleted_at' is null then
      action := 'restore';
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, old_row, new_row, actor_id, context)
  values (
    tg_table_name,
    coalesce(new_data ->> 'id', old_data ->> 'id'),
    action,
    old_data,
    new_data,
    auth.uid(),
    nullif(current_setting('app.audit_context', true), '')::jsonb
  );

  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'interventions', 'status_history', 'intervention_photos',
    'intervention_types', 'intervention_type_statuses', 'categories', 'category_groups',
    'programs', 'statuses', 'beneficiary_types', 'location_bases', 'icons',
    'municipalities', 'barangays', 'barangay_field_schema',
    'profiles', 'import_batches', 'saved_views'
  ] loop
    execute format(
      'create trigger audit_row after insert or update or delete on public.%I
       for each row execute function public.audit_row()',
      table_name
    );
  end loop;
end;
$$;
