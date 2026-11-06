-- Phase 5: icons for each category, and a record of every export.

-- ---------------------------------------------------------------------------
-- Category icons. The map and the exports both use a category's icon, and fall back to its type's.
-- Categories share icons by what the machine does, as dozens of different glyphs couldn't be told
-- apart at marker size. An Admin can change any of them per category.
-- ---------------------------------------------------------------------------

insert into public.icons (name, image) values
  ('Tractor',  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 3h7l1.300 6H18a2 2 0 0 1 2 2v3.600A4.500 4.500 0 0 0 13.100 18H9.900A4.500 4.500 0 0 0 3 14.700V11l2-1.200zm2 2v4h4l-.8-4z"/><circle cx="6" cy="18" r="3"/><circle cx="17.500" cy="18.500" r="2.500"/></svg>'),
  ('Seedling', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11 22v-7.600C6.500 14.200 3 11 2.500 5.500c4.700 0 7.900 1.700 9.300 4.800C13 6 16.500 2.500 21.500 2.500c0 6.300-3.300 10.800-8.500 11.800V22z"/></svg>'),
  ('Leaf',     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 3C10.500 3 4 8 4 15c0 1.400.3 2.700.8 3.900L2.500 21.300 4 22.800l2.300-2.400c1.200.6 2.500.9 3.900.9C17.500 21.300 22 14 21 3zM8 17.500c1.500-3.800 4-6.300 8-8-3 2.300-5 5-6.300 8.500z"/></svg>'),
  ('Grain',    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11 9h2v13h-2z"/><ellipse cx="12" cy="5" rx="2.300" ry="3.700"/><ellipse cx="7.300" cy="9.500" rx="2.200" ry="3.700" transform="rotate(-38 7.300 9.500)"/><ellipse cx="16.700" cy="9.500" rx="2.200" ry="3.700" transform="rotate(38 16.700 9.500)"/><ellipse cx="7.300" cy="15.500" rx="2.200" ry="3.700" transform="rotate(-38 7.300 15.500)"/><ellipse cx="16.700" cy="15.500" rx="2.200" ry="3.700" transform="rotate(38 16.700 15.500)"/></svg>'),
  ('Crate',    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l9.500 4.500v11L12 22l-9.500-4.500v-11zM5 9v7l6 2.900v-7zm14 0-6 2.900v7l6-2.900zM12 4.700 7.300 7 12 9.300 16.700 7z"/></svg>');

-- Each group has an icon, and a category takes its group's when it's created. That includes the
-- categories the record import adds, which may come before or after this migration.
alter table public.category_groups add column icon_id smallint references public.icons (id);

update public.category_groups g
set icon_id = (select id from public.icons where name = choice.icon)
from (values
  ('land_preparation', 'Tractor'),
  ('planting',         'Seedling'),
  ('crop_care',        'Leaf'),
  ('harvesting',       'Grain'),
  ('postharvest',      'Crate'),
  ('processing',       'Gear'),
  ('irrigation',       'Water'),
  ('other',            'Pin')
) as choice (group_code, icon)
where g.code = choice.group_code;

create function public.category_icon_from_group()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.icon_id is null then
    new.icon_id := (select icon_id from public.category_groups where id = new.category_group_id);
  end if;
  return new;
end;
$$;

create trigger category_icon_from_group
  before insert on public.categories
  for each row execute function public.category_icon_from_group();

update public.categories c
set icon_id = g.icon_id
from public.category_groups g
where c.category_group_id = g.id and c.icon_id is null;

update public.categories
set icon_id = (select id from public.icons where name = 'Sun')
where code = 'spis';

update public.categories
set icon_id = (select id from public.icons where name = 'Canal')
where code in ('sfr', 'swip', 'diversion-dam');

-- ---------------------------------------------------------------------------
-- Export log. Every signed-in role can export, so every signed-in role can add this one kind of
-- entry, through this function only. audit_log stays Admin-only to read, and who made the export
-- comes from the login, not from what the browser says.
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert', 'update', 'delete', 'soft_delete', 'restore', 'export'));

create function public.log_export(p_format text, p_file_name text, p_filters jsonb, p_record_count integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is null then
    raise exception 'Only members can export' using errcode = '42501';
  end if;
  if p_format not in ('kmz', 'kml', 'csv', 'geojson', 'shp') then
    raise exception 'Unknown export format' using errcode = '22023';
  end if;
  if p_record_count is null or p_record_count < 0 then
    raise exception 'The record count is missing' using errcode = '22023';
  end if;
  if length(p_file_name) > 255 or length(p_filters::text) > 4000 then
    raise exception 'The export details are too long' using errcode = '22023';
  end if;

  insert into public.audit_log (table_name, action, actor_id, context)
  values (
    'exports',
    'export',
    auth.uid(),
    jsonb_build_object('format', p_format, 'file_name', p_file_name, 'filters', p_filters, 'record_count', p_record_count)
  );
end;
$$;

grant execute on function public.log_export(text, text, jsonb, integer) to authenticated;
