-- Imports from the website, as one batch that can be undone as a whole, and flags a person has
-- looked at and accepted as they are.

-- ---------------------------------------------------------------------------
-- Held signals: a job that writes many rows tells open maps once, at the end
-- ---------------------------------------------------------------------------

create or replace function public.signal_map_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.hold_signals', true) = 'on' then
    return null;
  end if;
  -- A missed signal only delays a refresh. It must never stop the save.
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'map-changes', true);
  exception when others then
    raise warning 'map change signal failed: %', sqlerrm;
  end;
  return null;
end;
$$;

create function public.send_map_signal(p_table text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', p_table), 'changed', 'map-changes', true);
  exception when others then
    raise warning 'map change signal failed: %', sqlerrm;
  end;
end;
$$;

revoke execute on function public.send_map_signal(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------

alter table public.import_batches
  add column undone_at timestamptz,
  add column undone_by uuid references public.profiles (id),
  add column undo_reason text;

create trigger signal_map_change after insert or update or delete on public.import_batches
  for each statement execute function public.signal_map_change();

-- One batch, all or nothing. Each row is checked by the same rules as a record saved on the map, and
-- a refusal names the row it came from. The import columns, such as the source row, are written only
-- here. Up to 2,000 rows, so an import finishes well within the time a request is allowed.
create function public.import_records(p_batch jsonb, p_rows jsonb)
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
        public.point_from_json(record_values -> 'point'),
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

-- Takes a batch back off the map. Its records are deleted, so an Admin can still restore one, and
-- the log keeps every line. Refused once anyone has worked on a record from it, as that work would be
-- lost, and for the batches the RAED seed loaded by script.
create function public.undo_import(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  batch public.import_batches;
  changed integer;
  removed integer;
begin
  perform public.require_editor();
  select * into batch from public.import_batches where id = p_id for update;
  if not found then
    raise exception 'That import no longer exists.' using errcode = 'check_violation';
  end if;
  if batch.undone_at is not null then
    raise exception 'This import has already been undone.' using errcode = 'check_violation';
  end if;
  if batch.imported_by is null then
    raise exception 'This import was loaded by a script, so it can''t be undone here.' using errcode = 'check_violation';
  end if;
  if public.current_user_role() <> 'admin' and batch.imported_by is distinct from auth.uid() then
    -- Its own code, so the reason reaches the person rather than a general refusal.
    raise exception 'Only the person who imported it, or an Admin, can undo an import.' using errcode = 'DA403';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give a reason for undoing the import. It goes in the audit log.' using errcode = 'check_violation';
  end if;

  select count(*) into changed
  from public.interventions i
  where i.import_batch_id = p_id
    and (
      i.version > 1
      or (select count(*) from public.status_history s where s.intervention_id = i.id) > 1
      or exists (select 1 from public.intervention_photos p where p.intervention_id = i.id)
      or exists (select 1 from public.qa_dismissals d where d.intervention_id = i.id)
    );
  if changed > 0 then
    raise exception '% of its records % been worked on since, so undoing the import would lose that. Change or delete them one at a time instead.',
      changed, case when changed = 1 then 'has' else 'have' end using errcode = 'check_violation';
  end if;

  perform set_config('app.hold_signals', 'on', true);
  perform set_config('app.audit_context', jsonb_build_object('kind', 'import', 'reason', btrim(p_reason), 'undo', batch.file_name)::text, true);
  update public.interventions set deleted_at = now() where import_batch_id = p_id and deleted_at is null;
  get diagnostics removed = row_count;
  update public.import_batches set undone_at = now(), undone_by = auth.uid(), undo_reason = btrim(p_reason) where id = p_id;
  perform set_config('app.hold_signals', 'off', true);
  perform public.send_map_signal('interventions');
  return jsonb_build_object('records', removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dismissed flags
-- ---------------------------------------------------------------------------

-- A flag still says what the data says. A dismissal records that a person looked and accepted it, such
-- as a point at the FCA's office in the next barangay, so it leaves the QA queue and the count.
create table public.qa_dismissals (
  intervention_id uuid not null references public.interventions (id) on delete cascade,
  flag            text not null,
  reason          text not null check (btrim(reason) <> ''),
  dismissed_by    uuid default auth.uid() references public.profiles (id),
  dismissed_at    timestamptz not null default now(),
  primary key (intervention_id, flag)
);

alter table public.qa_dismissals enable row level security;
create policy "members read dismissals" on public.qa_dismissals
  for select to authenticated using ((select public.current_user_role()) is not null);
grant select on public.qa_dismissals to authenticated;

create trigger audit_row after insert or update or delete on public.qa_dismissals
  for each row execute function public.audit_row();
create trigger signal_map_change after insert or update or delete on public.qa_dismissals
  for each statement execute function public.signal_map_change();

-- A dismissal lasts only as long as its flag. When a change clears the flag, the dismissal goes too,
-- and if the flag comes back later, it's new and shows again.
create function public.qa_dismissals_follow_flags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.qa_dismissals where intervention_id = new.id and not (flag = any(new.qa_flags));
  return null;
end;
$$;

create trigger qa_dismissals_follow_flags
after update on public.interventions
for each row when (old.qa_flags is distinct from new.qa_flags)
execute function public.qa_dismissals_follow_flags();

-- The name check is a person's own flag, so dismissing it clears it, as Resolve flag does. Any other
-- flag stays, and is marked as looked at.
create function public.dismiss_flag(p_id uuid, p_flag text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  flags text[];
begin
  perform public.require_editor();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give a reason. It goes in the audit log.' using errcode = 'check_violation';
  end if;
  select qa_flags into flags from public.interventions where id = p_id and deleted_at is null;
  if not found then
    raise exception 'This record no longer exists.' using errcode = 'DA409';
  end if;
  if not (p_flag = any(flags)) then
    raise exception 'That flag is no longer on this record.' using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_context', jsonb_build_object('kind', 'dismiss', 'reason', btrim(p_reason))::text, true);
  if p_flag = 'beneficiary_name_check' then
    update public.interventions set qa_flags = array_remove(qa_flags, p_flag) where id = p_id;
  else
    insert into public.qa_dismissals (intervention_id, flag, reason)
    values (p_id, p_flag, btrim(p_reason))
    on conflict (intervention_id, flag) do update
      set reason = excluded.reason, dismissed_by = auth.uid(), dismissed_at = now();
  end if;
end;
$$;

-- Puts a dismissed flag back in the queue, such as after a mistake.
create function public.undismiss_flag(p_id uuid, p_flag text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_editor();
  perform set_config('app.audit_context', jsonb_build_object('kind', 'dismiss')::text, true);
  delete from public.qa_dismissals where intervention_id = p_id and flag = p_flag;
  if not found then
    raise exception 'That flag isn''t dismissed any more.' using errcode = 'check_violation';
  end if;
end;
$$;

-- A record's history includes its dismissals, as it does its status entries and photos.
create or replace function public.audit_for_intervention(p_id uuid)
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
     or (a.table_name in ('status_history', 'intervention_photos', 'qa_dismissals')
         and coalesce(a.new_row, a.old_row) ->> 'intervention_id' = p_id::text)
  order by a.id;
end;
$$;

-- The audit log page's record filter includes them too.
create or replace function public.audit_log_page(
  p_actor uuid default null,
  p_no_actor boolean default false,
  p_records jsonb default null,
  p_action text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  perform public.require_admin();

  with chosen as (
    select a.*
    from public.audit_log a
    where (p_actor is null or a.actor_id = p_actor)
      and (not p_no_actor or a.actor_id is null)
      and (p_action is null or a.action = p_action)
      and (p_from is null or a.at >= p_from)
      and (p_to is null or a.at <= p_to)
      and (
        p_records is null
        or (a.table_name = 'interventions' and a.record_id in (select jsonb_array_elements_text(p_records)))
        or (a.table_name in ('status_history', 'intervention_photos', 'qa_dismissals')
            and coalesce(a.new_row, a.old_row) ->> 'intervention_id' in (select jsonb_array_elements_text(p_records)))
      )
  ),
  page as (
    select c.*
    from chosen c
    order by c.at desc, c.id desc
    limit least(greatest(p_limit, 1), 200)
    offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from chosen),
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'table_name', p.table_name,
          'record_id', p.record_id,
          'action', p.action,
          'old_row', public.audit_row_for_display(p.old_row),
          'new_row', public.audit_row_for_display(p.new_row),
          'actor_id', p.actor_id,
          'actor_name', who.full_name,
          'context', p.context,
          'at', p.at
        )
        order by p.at desc, p.id desc
      )
      from page p
      left join public.profiles who on who.id = p.actor_id
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

grant execute on function
  public.import_records(jsonb, jsonb),
  public.undo_import(uuid, text),
  public.dismiss_flag(uuid, text, text),
  public.undismiss_flag(uuid, text)
to authenticated;
