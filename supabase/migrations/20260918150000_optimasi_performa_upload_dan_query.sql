-- ===========================================================================
-- Migrasi Optimasi Indeks Performa Upload dan Query Transaksi
-- ===========================================================================

-- 1. Index untuk cekStatusTahunLalu (query lintas partisi tahun lampau berdasarkan NIK)
-- Query: WHERE nik = $1 AND tahun <> $2
-- uq_penerima_nik saat ini adalah (tahun, nik), sehingga operator <> tahun tidak bisa seek NIK.
-- Index (nik, tahun) ini memungkinkan index-scan instan pada NIK apa pun tahunnya.
CREATE INDEX IF NOT EXISTS idx_penerima_nik_tahun
  ON penerima (nik, tahun);

-- 2. Composite functional index untuk cekKuotaTersedia & Dashboard
-- Query: WHERE tahun = $1 AND upper(kecamatan) = $2 AND upper(layanan) = $3
CREATE INDEX IF NOT EXISTS idx_penerima_tahun_kec_lay_upper
  ON penerima (tahun, upper(kecamatan), upper(layanan));

-- Update statistik planner PostgreSQL
ANALYZE penerima;
