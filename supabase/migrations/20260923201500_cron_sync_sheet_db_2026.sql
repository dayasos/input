-- ============================================================================
-- Migrasi: Jadwalkan Sinkronisasi Otomatis Google Sheets db_2026 ke Supabase
-- Jadwal: Tiap 10 menit via PostgreSQL pg_cron + pg_net (100% tanpa Google Apps Script)
-- Secret dibaca dari Supabase Vault ('sync_worker_secret'), BUKAN hardcode. Versi awal file ini sempat
-- memuat secret plaintext (sudah dicabut/diputar); job produksi diperbarui oleh migrasi 20260930090000.
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sync-otomatis-sheet-db-2026');
exception when others then null;
end $$;

select
  cron.schedule(
    'sync-otomatis-sheet-db-2026',
    '*/10 * * * *', -- Tiap 10 menit di cloud secara otomatis
    $$
    select net.http_post(
      url := 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'action', 'sinkronDataSheet2026',
        '_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_worker_secret' limit 1),
        'args', jsonb_build_array()
      )
    );
    $$
  );
