-- ============================================================
-- Partisi arsip: data_detail_2026
-- ============================================================
-- Dibutuhkan supaya fitur "Data Detail Rekapitulasi" bisa dipakai untuk tahun historis 2026,
-- bukan cuma TAHUN_AKTIF (2027) seperti sebelumnya (lihat perubahan ambilDataDetail() di
-- supabase/functions/api/domains/dataDetail.ts yang sekarang menerima parameter tahun).
-- penerima_2026 sudah ada sejak 20260914140000_partisi_penerima_2026.sql, tapi data_detail_2026
-- belum pernah dibuat -- insert data_detail tahun 2026 akan gagal ("no partition of relation
-- data_detail found for row") tanpa migrasi ini.
create table if not exists data_detail_2026 partition of data_detail for values in (2026);

-- RLS TIDAK ikut terwariskan otomatis dari tabel induk ke partisi baru (beda mekanisme dari
-- index/constraint) -- pola sama seperti catatan di 20260914140000_partisi_penerima_2026.sql
-- dan remediasi data_detail_2027 di 20260916160000_realtime_auth_and_backup_cron.sql.
alter table data_detail_2026 enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'data_detail_2026' and policyname = 'service_role_data_detail_2026'
  ) then
    create policy "service_role_data_detail_2026" on public.data_detail_2026 for all to service_role using (true);
  end if;
end $$;

-- Trigger event bus juga TIDAK diwariskan otomatis ke partisi baru -- wajib eksplisit per
-- partisi, persis catatan di penutup 20260920100100_trigger_event_bus_per_statement.sql.
drop trigger if exists trg_event_data_detail_2026 on public.data_detail_2026;
create trigger trg_event_data_detail_2026
after insert or update or delete on public.data_detail_2026
for each statement execute function public.fn_broadcast_realtime_event();

-- fn_broadcast_realtime_event() memetakan TG_TABLE_NAME ke domain event lewat daftar literal --
-- 'data_detail_2026' belum ada di daftarnya (dibuat sebelum partisi ini ada), jadi trigger di
-- atas akan terpasang tapi diam-diam tidak pernah mengirim sinyal 'data_detail' tanpa baris ini.
create or replace function public.fn_broadcast_realtime_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain varchar(50);
begin
  if TG_TABLE_NAME in ('penerima_2027', 'penerima', 'penerima_2026') then
    v_domain := 'penerima';
  elsif TG_TABLE_NAME in ('data_detail_2027', 'data_detail_2026', 'data_detail') then
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

  insert into public.realtime_event_bus (domain, aksi, entitas_id, created_at)
  values (v_domain, TG_OP, null, now());

  return null; -- diabaikan Postgres utk AFTER STATEMENT trigger
exception when others then
  -- Jangan gagalkan statement utama jika logging sinyal mengalami kendala
  return null;
end;
$$;

revoke execute on function public.fn_broadcast_realtime_event() from public, anon, authenticated;
grant execute on function public.fn_broadcast_realtime_event() to postgres, service_role;

-- PENTING untuk pergantian tahun berikutnya (mis. partisi penerima_2028/data_detail_2028):
-- ulangi KETIGA langkah di atas (partisi + RLS + trigger, dan tambahkan nama partisi baru ke
-- fn_broadcast_realtime_event) -- tidak ada satu pun yang otomatis mengikuti dari partisi lama.
