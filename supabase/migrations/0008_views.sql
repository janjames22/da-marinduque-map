-- Saved views with one shared default, and the Admin's audit log page.

-- ---------------------------------------------------------------------------
-- Saved views
-- ---------------------------------------------------------------------------

alter table public.saved_views add column is_default boolean not null default false;

-- is_default isn't in the column grants from 0005, so it only changes through set_default_view.
create unique index saved_views_one_default on public.saved_views (is_default) where is_default;
create unique index saved_views_owner_name on public.saved_views (owner_id, lower(name));

create function public.saved_views_before_write()
returns trigger
language plpgsql
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'a saved view needs a name' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'a saved view''s settings are not valid' using errcode = 'check_violation';
  end if;
  if new.is_default and not new.is_shared then
    raise exception 'the default view has to stay shared' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger saved_views_before_write
  before insert or update on public.saved_views
  for each row execute function public.saved_views_before_write();

-- An Admin can take down a shared view, such as one left by someone who has moved on.
create policy "admins delete shared views" on public.saved_views
  for delete to authenticated
  using ((select public.current_user_role()) = 'admin' and is_shared);

-- Passing null means no default, so everyone opens on the usual map.
create function public.set_default_view(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_admin();

  update public.saved_views set is_default = false where is_default and id is distinct from p_id;
  if p_id is not null then
    update public.saved_views set is_default = true where id = p_id and is_shared;
    if not found then
      raise exception 'only a shared view can be the default' using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

-- So a newly shared view appears on open maps without a reload.
create trigger signal_map_change after insert or update or delete on public.saved_views
  for each statement execute function public.signal_map_change();

-- ---------------------------------------------------------------------------
-- The audit log page
-- ---------------------------------------------------------------------------

create index audit_log_at_idx on public.audit_log (at desc, id desc);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- One page, newest first, with how many there are in all. A record's changes include its status
-- entries and photos. The page's own limit keeps one request from asking for the whole log.
create function public.audit_log_page(
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
        or (a.table_name in ('status_history', 'intervention_photos')
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
  public.set_default_view(uuid),
  public.audit_log_page(uuid, boolean, jsonb, text, timestamptz, timestamptz, integer, integer)
to authenticated;
