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

-- Migrasi (aman diulang): mode lock/unlock dan dana per goal. Baris lama = 'lock' tanpa dana (kunci seluruh saldo jaringan).
alter table public.goals add column if not exists mode text not null default 'lock';
alter table public.goals add column if not exists funded_value numeric;
do $$
begin
  alter table public.goals add constraint goals_mode_check check (mode in ('lock', 'unlock'));
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.goals add constraint goals_funded_check check (funded_value is null or funded_value > 0);
exception when duplicate_object then null;
end $$;

-- Kunci waktu "semua jaringan" per wallet. Tidak ada kebijakan delete, dan trigger menolak pemendekan selagi kunci aktif.
create table if not exists public.wallet_locks (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  wallet_ref    text not null check (char_length(wallet_ref) between 16 and 64),
  locked_until  timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, wallet_ref)
);

create or replace function public.wallet_locks_no_shorten() returns trigger language plpgsql as $fn$
begin
  if old.locked_until > now() and new.locked_until < old.locked_until then
    raise exception 'locked_until tidak boleh diperpendek selagi kunci masih aktif';
  end if;
  return new;
end
$fn$;
drop trigger if exists wallet_locks_no_shorten on public.wallet_locks;
create trigger wallet_locks_no_shorten before update on public.wallet_locks for each row execute function public.wallet_locks_no_shorten();

alter table public.wallet_locks enable row level security;
drop policy if exists "locks_select_own" on public.wallet_locks;
drop policy if exists "locks_insert_own" on public.wallet_locks;
drop policy if exists "locks_update_own" on public.wallet_locks;
create policy "locks_select_own" on public.wallet_locks for select using (auth.uid() = user_id);
create policy "locks_insert_own" on public.wallet_locks for insert with check (auth.uid() = user_id);
create policy "locks_update_own" on public.wallet_locks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Riwayat transaksi, DIENKRIPSI di perangkat (AES-GCM; kunci dari private key wallet). Server hanya menyimpan ciphertext,
-- penanda wallet (HMAC), chain id, dan waktu. Hash, alamat, jumlah, dan status tidak terbaca.
create table if not exists public.tx_history (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id          text not null check (char_length(id) between 16 and 64),
  wallet_ref  text not null check (char_length(wallet_ref) between 16 and 64),
  chain_id    bigint not null,
  ts          timestamptz not null,
  payload     text not null check (char_length(payload) between 40 and 4096),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists tx_history_wallet_idx on public.tx_history (user_id, wallet_ref, ts desc);

alter table public.tx_history enable row level security;
drop policy if exists "history_select_own" on public.tx_history;
drop policy if exists "history_insert_own" on public.tx_history;
drop policy if exists "history_update_own" on public.tx_history;
drop policy if exists "history_delete_own" on public.tx_history;
create policy "history_select_own" on public.tx_history for select using (auth.uid() = user_id);
create policy "history_insert_own" on public.tx_history for insert with check (auth.uid() = user_id);
create policy "history_update_own" on public.tx_history for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "history_delete_own" on public.tx_history for delete using (auth.uid() = user_id);

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
do $$
begin
  alter publication supabase_realtime add table public.tx_history;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.wallet_locks;
exception when duplicate_object then null;
end $$;
