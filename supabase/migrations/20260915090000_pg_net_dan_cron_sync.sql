-- ============================================================
-- Trigger sync-worker (proses sync_outbox -> Google Sheets) tiap 1 menit
-- ============================================================
-- pg_net dipakai pg_cron untuk memanggil Edge Function sync-worker lewat HTTP dari DALAM
-- Supabase sendiri -- tidak lewat Vercel Cron karena plan Vercel saat ini ("hobby") membatasi
-- cron cuma bisa jalan 1x/hari, terlalu jarang untuk sinkronisasi yang perlu terasa hampir langsung.
create extension if not exists pg_net;

-- Secret sync-worker (dicek endpoint-nya, lihat sync-worker/index.ts) disimpan di Supabase Vault,
-- BUKAN hardcode di sini -- supaya nilainya tidak tercatat plaintext di riwayat git migrasi.
-- Diisi programatik sekali via CLI (supabase db query) saat setup, bukan manual oleh user.
select
  cron.schedule(
    'proses-sync-outbox-ke-sheets',
    '* * * * *', -- tiap 1 menit
    $$
    select net.http_post(
      url := 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/sync-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_worker_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
    $$
  )
where not exists (
  select 1 from cron.job where jobname = 'proses-sync-outbox-ke-sheets'
);
