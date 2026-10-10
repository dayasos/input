-- Domisili lintas kecamatan (Rencana Perbaikan Wilayah Tugas dan Domisili, 2026-10-09).
--
-- Mulai sekarang kolom `kecamatan`/`kelurahan` di penerima & data_detail KONSISTEN berarti
-- WILAYAH TUGAS (dasar kuota, hak akses akun kecamatan, laporan ke dinas). Domisili penerima
-- disimpan TERPISAH di dua kolom baru ini, supaya warga yang bertugas di satu kecamatan tapi
-- berdomisili di kecamatan lain tercatat benar tanpa menggeser kuota/laporan.
--
-- Kolom ditaruh di UJUNG tabel (sama pola 20261008100000): kode & sheet cermin memakai posisi
-- kolom 0..40, jadi tidak boleh ada kolom yang disisipkan di tengah. ALTER di tabel induk
-- otomatis berlaku untuk semua partisi tahun.
--
-- Backfill hanya tahun 2027 (335 baris live per 2026-10-09): domisili = nilai yang tersimpan
-- sekarang. Sebelum perubahan ini, formulir menyalin kecamatan tugas ke kecamatan domisili dan
-- menguncinya, lalu `kelurahan` diisi dari dropdown "Kelurahan Domisili" -- jadi nilai lama itu
-- memang domisili (dan sudah diverifikasi semua kelurahan lama berada di kecamatan tugasnya).
-- Arsip 2026 sengaja dibiarkan NULL (data hasil sinkron sheet, bukan input aplikasi ini).
-- Isi kolom lama TIDAK diubah sama sekali.
--
-- Idempoten: aman dijalankan ulang (add column if not exists + backfill hanya yang masih NULL).

alter table penerima    add column if not exists kecamatan_domisili text;
alter table penerima    add column if not exists kelurahan_domisili text;
alter table data_detail add column if not exists kecamatan_domisili text;
alter table data_detail add column if not exists kelurahan_domisili text;

update penerima
   set kecamatan_domisili = kecamatan,
       kelurahan_domisili = kelurahan
 where tahun = 2027
   and kecamatan_domisili is null
   and kelurahan_domisili is null;

update data_detail
   set kecamatan_domisili = kecamatan,
       kelurahan_domisili = kelurahan
 where tahun = 2027
   and kecamatan_domisili is null
   and kelurahan_domisili is null;
