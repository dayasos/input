-- ============================================================================
-- Migrasi: Supabase Realtime Publication, Log Backup Sistem, dan Cron 3x Sehari
-- ============================================================================

-- 1. Daftarkan tabel-tabel operasional ke publikasi supabase_realtime
-- Agar seluruh perubahan (INSERT, UPDATE, DELETE) disiarkan via WebSocket CDC ke klien
do $$
begin
  begin
    alter publication supabase_realtime add table penerima;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table kuota;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table setelan;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table akun;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table data_detail;
  exception when duplicate_object then null;
  end;
end $$;

-- 2. Hentikan dan hapus jadwal cron outbox 1-menit yang lama
do $$
begin
  perform cron.unschedule('proses-sync-outbox-ke-sheets');
exception when others then null;
end $$;

-- 3. Hapus tabel antrian sync_outbox (tidak digunakan lagi)
drop table if exists sync_outbox cascade;

-- 4. Buat tabel audit log backup sistem
create table if not exists log_backup_sistem (
  id bigserial primary key,
  waktu timestamptz not null default now(),
  status varchar(20) not null,
  jumlah_baris integer default 0,
  durasi_ms integer default 0,
  pesan_error text,
  mode varchar(20) default 'SCHEDULED'
);
alter table log_backup_sistem enable row level security;

-- 4b. Remediasi Keamanan: Aktifkan RLS pada data_detail_2027
alter table if exists data_detail_2027 enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'data_detail_2027' and policyname = 'service_role_data_detail_2027'
  ) then
    create policy "service_role_data_detail_2027" on public.data_detail_2027 for all to service_role using (true);
  end if;
end $$;

-- 5. Daftarkan jadwal Auto-Backup Spreadsheet 3x Sehari (Tiap 8 Jam)
-- Jadwal: 08.00 WIB (01.00 UTC), 16.00 WIB (09.00 UTC), 00.00 WIB (17.00 UTC)
select
  cron.schedule(
    'auto-backup-spreadsheet-3x-sehari',
    '0 1,9,17 * * *',
    $$
    select net.http_post(
      url := 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/backup-spreadsheet',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'sync_worker_secret' limit 1), 'DJPM2027_BACKUP_SECRET')
      ),
      body := '{"mode":"scheduled"}'::jsonb
    );
    $$
  )
where not exists (
  select 1 from cron.job where jobname = 'auto-backup-spreadsheet-3x-sehari'
);
