-- ============================================================================
-- Migrasi: Jadwalkan pembersihan otomatis idempotency_keys via pg_cron
-- ============================================================================
-- 20260919111400_idempotency_keys.sql membuat tabelnya tapi HANYA menaruh perintah
-- cron.schedule() sebagai KOMENTAR yang harus dijalankan manual di Supabase Dashboard SQL
-- Editor -- berbeda dari 2 cron job lain (bersihkan-realtime-event-bus, auto-backup-spreadsheet)
-- yang langsung dijadwalkan di migrasi SQL. Langkah manual seperti itu gampang terlewat/lupa,
-- dan sejauh code review tidak ada bukti langkah itu pernah benar-benar dijalankan -- artinya
-- tabel ini berpotensi tumbuh tanpa batas selamanya (menambah beban VACUUM & storage, walau
-- lookup per-key sendiri tetap cepat karena primary key).
--
-- Perbaikan: jadwalkan langsung di migrasi, konsisten dengan 2 cron job lain. Interval
-- pembersihan (15 menit) sama persis dengan yang disebut di komentar migrasi asal -- cukup
-- longgar dibanding masa hidup token idempoten (dipakai cuma utk retry akibat koneksi
-- putus/timeout _TIMEOUT_AKSI_MS 58 detik di api-bridge.js, jauh di bawah 15 menit).
select
  cron.schedule(
    'bersihkan-idempotency-keys',
    '*/15 * * * *',
    $$
    delete from public.idempotency_keys where created_at < now() - interval '15 minutes';
    $$
  )
where not exists (
  select 1 from cron.job where jobname = 'bersihkan-idempotency-keys'
);
