-- ============================================================================
-- Migrasi: Realtime Event Bus Bebas-PII & Pembersihan Keamanan
-- ============================================================================

-- 1. Remediasi Keamanan: Hapus fungsi testing uji_login_mandiri yang memiliki celah keamanan
drop function if exists public.uji_login_mandiri(text, text);

-- 2. Buat tabel sinyal event bus untuk penyiaran CDC Realtime tanpa mengekspos PII
create table if not exists public.realtime_event_bus (
  id bigserial primary key,
  domain varchar(50) not null,
  aksi varchar(50) not null default 'MUTATION',
  entitas_id text,
  created_at timestamptz not null default now()
);

-- Indeks untuk query performa tinggi dan pembersihan cepat
create index if not exists idx_realtime_event_bus_created on public.realtime_event_bus (created_at desc);

-- 3. Row Level Security pada Event Bus
-- Tabel ini TIDAK memuat PII apa pun (hanya nama domain & tipe aksi),
-- sehingga aman untuk dibaca secara realtime oleh peran anon
alter table public.realtime_event_bus enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'realtime_event_bus'
      and policyname = 'anon_select_realtime_event_bus'
  ) then
    create policy "anon_select_realtime_event_bus"
      on public.realtime_event_bus
      for select
      to anon, authenticated, service_role
      using (true);
  end if;
end $$;

-- 4. Daftarkan tabel realtime_event_bus ke publikasi supabase_realtime
do $$
begin
  alter publication supabase_realtime add table public.realtime_event_bus;
exception when duplicate_object then null;
end $$;

-- 5. Fungsi Trigger PostgreSQL untuk menyiarkan event domain saat terjadi mutasi
create or replace function public.fn_broadcast_realtime_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain varchar(50);
  v_aksi varchar(50);
  v_id text := null;
begin
  if TG_TABLE_NAME in ('penerima_2027', 'penerima', 'penerima_2026') then
    v_domain := 'penerima';
  elsif TG_TABLE_NAME in ('data_detail_2027', 'data_detail') then
    v_domain := 'data_detail';
  elsif TG_TABLE_NAME = 'kuota' or TG_TABLE_NAME = 'kuota_katolik' then
    v_domain := 'kuota';
  elsif TG_TABLE_NAME = 'setelan' then
    v_domain := 'setelan';
  elsif TG_TABLE_NAME = 'akun' then
    v_domain := 'akun';
  else
    v_domain := TG_TABLE_NAME;
  end if;

  v_aksi := TG_OP; -- INSERT, UPDATE, DELETE

  insert into public.realtime_event_bus (domain, aksi, entitas_id, created_at)
  values (v_domain, v_aksi, v_id, now());

  return coalesce(NEW, OLD);
exception when others then
  -- Jangan gagalkan transaksi utama jika logging sinyal mengalami kendala
  return coalesce(NEW, OLD);
end;
$$;

-- Cabut izin eksekusi langsung dari anon & public (fungsi ini hanya untuk trigger PostgreSQL)
revoke execute on function public.fn_broadcast_realtime_event() from public, anon, authenticated;
grant execute on function public.fn_broadcast_realtime_event() to postgres, service_role;

-- 6. Pasang Trigger ke tabel-tabel utama
drop trigger if exists trg_event_penerima_2027 on public.penerima_2027;
create trigger trg_event_penerima_2027
after insert or update or delete on public.penerima_2027
for each row execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_kuota on public.kuota;
create trigger trg_event_kuota
after insert or update or delete on public.kuota
for each row execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_setelan on public.setelan;
create trigger trg_event_setelan
after insert or update or delete on public.setelan
for each row execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_akun on public.akun;
create trigger trg_event_akun
after insert or update or delete on public.akun
for each row execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_data_detail_2027 on public.data_detail_2027;
create trigger trg_event_data_detail_2027
after insert or update or delete on public.data_detail_2027
for each row execute function public.fn_broadcast_realtime_event();

-- 7. Jadwalkan pembersihan otomatis event bus yang lebih tua dari 1 jam (tiap jam)
select
  cron.schedule(
    'bersihkan-realtime-event-bus',
    '30 * * * *',
    $$
    delete from public.realtime_event_bus where created_at < now() - interval '1 hour';
    $$
  )
where not exists (
  select 1 from cron.job where jobname = 'bersihkan-realtime-event-bus'
);
