-- Network schedule: writable milestone table counting down to "day 0" (go-live).
-- Each milestone has a day offset (negative = days before go-live, 0 = go-live,
-- positive = after go-live), an optional concrete milestone date, and a status.
-- A cumulative summary (total / completed / % achieved) is derived by the client.

create table if not exists public.network_schedule (
  id uuid primary key default gen_random_uuid(),
  day integer not null default 0,
  title text not null,
  description text,
  milestone_date date,
  status text not null default 'PLANNED'
    check (status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.network_schedule enable row level security;

create index if not exists idx_network_schedule_day on public.network_schedule(day);

-- read: any authenticated user (project schedule is company-wide visibility)
drop policy if exists "network_schedule_select" on public.network_schedule;
create policy "network_schedule_select" on public.network_schedule
  for select to authenticated using (true);

-- write: admin.settings only
drop policy if exists "network_schedule_insert" on public.network_schedule;
create policy "network_schedule_insert" on public.network_schedule
  for insert to authenticated with check (public.has_privilege('admin.settings'));

drop policy if exists "network_schedule_update" on public.network_schedule;
create policy "network_schedule_update" on public.network_schedule
  for update to authenticated using (public.has_privilege('admin.settings'));

drop policy if exists "network_schedule_delete" on public.network_schedule;
create policy "network_schedule_delete" on public.network_schedule
  for delete to authenticated using (public.has_privilege('admin.settings'));

-- Seed a default schedule from day -14 (t-minus) down to day 0 (go-live).
insert into public.network_schedule (day, title, description, status) values
  (-14, 'Project kickoff', 'Network rollout project kickoff and team assignment.', 'COMPLETED'),
  (-12, 'Site survey & planning', 'Site surveys complete; wiring and routing plan approved.', 'COMPLETED'),
  (-10, 'Equipment procurement', 'Core network equipment ordered and delivery confirmed.', 'COMPLETED'),
  (-8, 'Installation phase 1', 'Risers, racks and backbone cabling installed.', 'IN_PROGRESS'),
  (-6, 'Installation phase 2', 'Access switches, APs and end-device drops terminated.', 'PLANNED'),
  (-4, 'Configuration & integration', 'Switches/VLANs configured; integration with DNS/DHCP.', 'PLANNED'),
  (-2, 'Testing & hardening', 'Link tests, failover and security hardening.', 'PLANNED'),
  (-1, 'Cutover dry run', 'Full cutover rehearsal and rollback plan verified.', 'PLANNED'),
  (0, 'GO-LIVE', 'Network goes live to all users.', 'PLANNED')
on conflict do nothing;