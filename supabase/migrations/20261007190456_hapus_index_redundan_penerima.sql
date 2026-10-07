-- Hapus 2 index induk yang REDUNDAN (prefix) pada tabel partisi penerima.
--   idx_penerima_tahun_kecamatan_upper (tahun, upper(kecamatan))
--     -> sudah tercakup idx_penerima_tahun_kec_lay_upper (tahun, upper(kecamatan), upper(layanan))
--   idx_penerima_tahun_layanan_upper   (tahun, upper(layanan))
--     -> sudah tercakup idx_penerima_tahun_layanan_kecamatan_upper (tahun, upper(layanan), upper(kecamatan))
-- Index composit memuat kolom-kolom itu di depan, jadi query yang sama tetap memakai index. Index
-- anak (penerima_2026/2027_tahun_upper_idx & _idx1) ikut terhapus karena terikat ke induknya.
-- DROP INDEX CONCURRENTLY tidak didukung utk index induk partisi; tabel kecil, kuncinya sebentar.
DROP INDEX IF EXISTS public.idx_penerima_tahun_kecamatan_upper;
DROP INDEX IF EXISTS public.idx_penerima_tahun_layanan_upper;
