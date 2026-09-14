-- Pembersihan berkala sesi kedaluwarsa & jendela brute-force lama (pengganti TTL otomatis CacheService).
-- Catatan: jika `create extension pg_cron` gagal karena hak akses saat migrasi lewat CLI,
-- aktifkan dulu ekstensi "pg_cron" lewat Dashboard Supabase > Database > Extensions, lalu jalankan
-- ulang migrasi ini (atau jalankan isi file ini manual lewat SQL Editor).
create extension if not exists pg_cron with schema extensions;

select
  cron.schedule(
    'bersihkan-sesi-login-kedaluwarsa',
    '*/30 * * * *',            -- tiap 30 menit
    $$ delete from public.sesi_login where kedaluwarsa_at < now(); $$
  )
where not exists (
  select 1 from cron.job where jobname = 'bersihkan-sesi-login-kedaluwarsa'
);

select
  cron.schedule(
    'bersihkan-login-percobaan-gagal-lama',
    '0 * * * *',                -- tiap jam
    $$ delete from public.login_percobaan_gagal where jendela_mulai < now() - interval '1 day'; $$
  )
where not exists (
  select 1 from cron.job where jobname = 'bersihkan-login-percobaan-gagal-lama'
);
