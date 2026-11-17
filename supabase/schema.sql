-- Kunci Wallet: skema Supabase untuk sinkron goal (OPSIONAL).
-- Jalankan di Supabase Dashboard > SQL Editor. Aman dijalankan ulang.
--
-- Yang disimpan: nama goal, jaringan, satuan, nilai awal/target, status, dan snapshot nilai.
-- TIDAK disimpan: alamat wallet, kunci, recovery phrase, password. Kolom wallet_ref adalah HMAC
-- yang hanya bisa dihitung pemilik wallet (lihat src/goals/ref.ts).

create table if not exists public.goals (
  id                   uuid primary key,
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  wallet_ref           text not null check (char_length(wallet_ref) between 16 and 64),
  name                 text not null check (char_length(name) between 1 and 40),
  chain_id             integer not null,
  unit                 text not null check (unit in ('usd', 'native')),
  start_value          numeric not null default 0 check (start_value >= 0),
  target_value         numeric not null check (target_value > 0),
  status               text not null default 'active' check (status in ('active', 'achieved', 'cancelled')),
  created_at           timestamptz not null default now(),
  achieved_at          timestamptz,
  cancel_requested_at  timestamptz,
  updated_at           timestamptz not null default now()
);

create table if not exists public.goal_snapshots (
  id        bigint generated always as identity primary key,
  goal_id   uuid not null references public.goals(id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ts        timestamptz not null default now(),
  value     numeric not null
);

create index if not exists goals_user_idx on public.goals (user_id);
create index if not exists goal_snapshots_goal_ts_idx on public.goal_snapshots (goal_id, ts desc);

-- Row Level Security: setiap pengguna hanya melihat dan mengubah datanya sendiri.
alter table public.goals enable row level security;
alter table public.goal_snapshots enable row level security;

drop policy if exists "goals_select_own" on public.goals;
drop policy if exists "goals_insert_own" on public.goals;
drop policy if exists "goals_update_own" on public.goals;
drop policy if exists "goals_delete_own" on public.goals;
create policy "goals_select_own" on public.goals for select using (auth.uid() = user_id);
create policy "goals_insert_own" on public.goals for insert with check (auth.uid() = user_id);
create policy "goals_update_own" on public.goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals_delete_own" on public.goals for delete using (auth.uid() = user_id);

drop policy if exists "snaps_select_own" on public.goal_snapshots;
drop policy if exists "snaps_insert_own" on public.goal_snapshots;
drop policy if exists "snaps_delete_own" on public.goal_snapshots;
create policy "snaps_select_own" on public.goal_snapshots for select using (auth.uid() = user_id);
create policy "snaps_insert_own" on public.goal_snapshots for insert
  with check (auth.uid() = user_id and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid()));
create policy "snaps_delete_own" on public.goal_snapshots for delete using (auth.uid() = user_id);

-- Realtime: perubahan goal dari satu perangkat muncul langsung di perangkat lain.
do $$
begin
  alter publication supabase_realtime add table public.goals;
exception when duplicate_object then null;
end $$;
