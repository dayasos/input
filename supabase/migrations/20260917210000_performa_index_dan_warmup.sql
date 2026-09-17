CREATE INDEX IF NOT EXISTS idx_sesi_login_token
  ON sesi_login (token);

-- Bantu cleanup cron (bersihkan sesi kedaluwarsa)
CREATE INDEX IF NOT EXISTS idx_sesi_login_kedaluwarsa
  ON sesi_login (kedaluwarsa_at);

-- ── 2. Index komposit penerima untuk RBAC query ────────────────────────────
-- Query per kecamatan (KECAMATAN role): WHERE tahun = $1 AND upper(kecamatan) = $2
-- Postgres tidak bisa pakai index reguler untuk upper(kecamatan) — perlu functional index.
CREATE INDEX IF NOT EXISTS idx_penerima_tahun_kecamatan_upper
  ON penerima (tahun, upper(kecamatan));

-- Query per layanan (KEMENAG role): WHERE tahun = $1 AND upper(layanan) = $2
CREATE INDEX IF NOT EXISTS idx_penerima_tahun_layanan_upper
  ON penerima (tahun, upper(layanan));

-- Query per layanan + kecamatan (KEMENAG dengan kecamatan tetap):
-- WHERE tahun = $1 AND upper(layanan) = $2 AND upper(kecamatan) = $3
CREATE INDEX IF NOT EXISTS idx_penerima_tahun_layanan_kecamatan_upper
  ON penerima (tahun, upper(layanan), upper(kecamatan));

-- ── 3. Index layanan_master untuk subquery filter kemenag ──────────────────
-- Subquery: SELECT upper(nama_layanan) FROM layanan_master WHERE kategori = 'KEMENAG'
CREATE INDEX IF NOT EXISTS idx_layanan_master_kategori
  ON layanan_master (kategori);

ANALYZE sesi_login;
ANALYZE penerima;
ANALYZE layanan_master;
