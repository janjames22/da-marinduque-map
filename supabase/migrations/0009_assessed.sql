-- Which statuses say whether a unit works. % operational counts only those, out of the units at them.
-- Turned-over says a unit was delivered, not that anyone has checked it since, so it's left out, as
-- Unknown is. An Admin can change any of these in Admin, Statuses.

alter table public.statuses add column counts_as_assessed boolean not null default true;

-- These say where a unit is in delivery or building, or nothing at all, rather than its condition.
update public.statuses set counts_as_assessed = false
where name in ('Turned-over', 'Undelivered/For Distribution', 'Proposed', 'Inventory', 'On-going', 'Completed', 'Unknown');
