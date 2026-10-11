-- ============================================================================
-- Sinkron data arsip 2026 (sheet db_2026 -> penerima/data_detail 2026): jalan SEKALI SEHARI pukul 00.00 WIB
-- dan batas waktu permintaan diperpanjang jadi 60 detik.
--
-- Latar belakang (2026-10-11):
--  * Sebelumnya job berjalan tiap 10 menit (144x/hari, ~13 detik per run) padahal 2026 adalah data arsip yang
--    jarang berubah; beban itu ikut memperlambat fungsi `api` yang sama.
--  * pg_net membatalkan permintaan setelah 5 detik (bawaan) padahal sinkron butuh ~13 detik, sehingga respons
--    (sukses/gagal) tidak pernah tercatat di net._http_response. Dengan timeout 60 detik hasilnya bisa dicek.
--    Catatan: pg_net hanya menyimpan respons ±6 jam, jadi pengecekan paling mudah dilakukan pagi hari.
--
-- Zona waktu pg_cron di proyek ini = UTC (cron.timezone = GMT). 00.00 WIB = 17.00 UTC hari sebelumnya.
-- Secret tetap dibaca dari Supabase Vault (`sync_worker_secret`), tidak ada secret di file ini.
-- Tombol "Sinkron Sheet 2026" manual di aplikasi (khusus Admin Utama) tidak berubah.
-- Kembali ke jadwal lama: ganti '0 17 * * *' menjadi '*/10 * * * *' dan hapus timeout_milliseconds.
-- ============================================================================

do $$
begin
  perform cron.unschedule('sync-otomatis-sheet-db-2026');
exception when others then null;
end $$;

select
  cron.schedule(
    'sync-otomatis-sheet-db-2026',
    '0 17 * * *',
    $$
    select net.http_post(
      url := 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'action', 'sinkronDataSheet2026',
        '_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_worker_secret' limit 1),
        'args', jsonb_build_array()
      ),
      timeout_milliseconds := 60000
    );
    $$
  );
