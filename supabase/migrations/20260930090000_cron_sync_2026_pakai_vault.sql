-- ============================================================================
-- Perbaikan keamanan: job pg_cron 'sync-otomatis-sheet-db-2026' TIDAK lagi membawa secret plaintext.
--
-- Latar belakang: migrasi 20260923201500 semula menyimpan `_secret` API langsung di SQL dan ikut
-- ter-commit ke repo publik. Nilai itu sama dengan GAS_SECRET_TOKEN (kunci "Mode 1" di
-- functions/api/index.ts yang melewati gerbang sesi), jadi WAJIB diputar (lihat langkah rotasi di
-- pesan commit / catatan rilis). Migrasi ini menjadwalkan ulang job supaya membaca secret dari
-- Supabase Vault (`sync_worker_secret`, dipakai juga oleh cron backup) -- Edge Function `api`
-- sudah menerima nilai itu lewat env SYNC_WORKER_SECRET.
--
-- Fail-closed: kalau secret di Vault kosong, `_secret` bernilai null dan Edge Function menolak
-- request (tidak ada fallback ke nilai bawaan).
-- ============================================================================

do $$
begin
  perform cron.unschedule('sync-otomatis-sheet-db-2026');
exception when others then null;
end $$;

select
  cron.schedule(
    'sync-otomatis-sheet-db-2026',
    '*/10 * * * *',
    $$
    select net.http_post(
      url := 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'action', 'sinkronDataSheet2026',
        '_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_worker_secret' limit 1),
        'args', jsonb_build_array()
      )
    );
    $$
  );
