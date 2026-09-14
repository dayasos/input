-- ============================================================
-- Longgarkan constraint unik nomor rekening KHUSUS untuk partisi arsip (bukan tahun aktif)
-- ============================================================
-- Sama alasan & pola dengan 20260914150000_longgarkan_tempat_tugas_arsip.sql: ditemukan 2 pasang
-- baris bentrok nyata di db_2026 (2 NIK berbeda memakai nomor rekening yang sama) -- data arsip
-- historis, tidak pernah divalidasi ulang terhadap constraint ini. Dipindah dari tabel induk ke
-- partisi penerima_2027 langsung, konsekuensi sama: index ini TIDAK otomatis terwarisi ke partisi
-- tahun aktif berikutnya, harus dibuat manual saat pergantian tahun (lihat catatan di migrasi
-- tempat-tugas untuk detail & alasan lengkap).
drop index uq_penerima_rekening;

create unique index if not exists uq_penerima_2027_rekening on penerima_2027 (tahun, nomor_rekening)
  where nomor_rekening <> '';
