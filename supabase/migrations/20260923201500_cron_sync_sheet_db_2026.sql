-- ============================================================================
-- Migrasi: Jadwalkan Sinkronisasi Otomatis Google Sheets db_2026 ke Supabase
-- Jadwal: Tiap 10 menit via PostgreSQL pg_cron + pg_net (100% tanpa Google Apps Script)
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
        '_secret', 'Khixq6EFhuG7oSuYa5L29E5e3tvT9OzguvQs2DpJjkY',
        'args', jsonb_build_array()
      )
    );
    $$
  );
