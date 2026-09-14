-- ============================================================
-- Partisi arsip: penerima_2026 (sheet db_2026, 12.361 baris — dikonfirmasi dry-run backfill)
-- ============================================================
-- Index & constraint unik di tabel induk `penerima` otomatis berlaku untuk partisi baru ini
-- (perilaku standar Postgres 11+ untuk index, lihat catatan di 20260907090200_penerima_partitioned.sql).
create table if not exists penerima_2026 partition of penerima for values in (2026);

-- RLS TIDAK ikut terwariskan otomatis seperti index/constraint (beda mekanisme) -- dikonfirmasi
-- empiris saat penerima_2027 ternyata RLS-nya mati meski induknya sudah aktif (lihat
-- 20260914130000_enable_rls_partisi_penerima.sql). Jadi WAJIB eksplisit di setiap partisi baru,
-- jangan mengandalkan warisan dari induk.
alter table penerima_2026 enable row level security;
