-- Normalisasi jenis rumah ibadah untuk Manajemen Data Rumah Ibadah.
-- PGK dapat dikonversi deterministik menjadi GEREJA_KATOLIK. Sebaliknya,
-- VIHARA_KLENTENG_KUIL TIDAK boleh dipetakan otomatis karena jenis sebenarnya
-- tidak bisa disimpulkan dengan aman dari nama/alamat saja.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.rumah_ibadah
  drop constraint if exists rumah_ibadah_jenis_check;

-- Fase transisi: izinkan nilai lama hanya agar seluruh data yang belum
-- diklasifikasikan tetap utuh selama normalisasi berlangsung.
alter table public.rumah_ibadah
  add constraint rumah_ibadah_jenis_check
  check (jenis in (
    'MASJID', 'MUSHOLLA', 'GEREJA', 'GEREJA_KATOLIK', 'VIHARA', 'KLENTENG', 'KUIL',
    'PGK', 'VIHARA_KLENTENG_KUIL'
  )) not valid;

update public.rumah_ibadah
set jenis = 'GEREJA_KATOLIK'
where jenis = 'PGK';

-- PGK selesai dinormalisasi. Nilai gabungan lama tetap sementara sampai
-- operator mengklasifikasikan setiap baris ke Vihara, Klenteng, atau Kuil.
alter table public.rumah_ibadah
  drop constraint rumah_ibadah_jenis_check;

alter table public.rumah_ibadah
  add constraint rumah_ibadah_jenis_check
  check (jenis in (
    'MASJID', 'MUSHOLLA', 'GEREJA', 'GEREJA_KATOLIK', 'VIHARA', 'KLENTENG', 'KUIL',
    'VIHARA_KLENTENG_KUIL'
  )) not valid;

alter table public.rumah_ibadah
  validate constraint rumah_ibadah_jenis_check;

commit;
