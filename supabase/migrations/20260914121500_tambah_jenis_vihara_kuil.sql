-- ============================================================
-- Migration: Tambah jenis 'VIHARA' dan 'KUIL' pada tabel rumah_ibadah
-- ============================================================
alter table rumah_ibadah drop constraint if exists rumah_ibadah_jenis_check;
alter table rumah_ibadah add constraint rumah_ibadah_jenis_check
  check (jenis in ('MASJID', 'MUSHOLLA', 'GEREJA', 'PGK', 'VIHARA_KLENTENG_KUIL', 'VIHARA', 'KUIL'));
