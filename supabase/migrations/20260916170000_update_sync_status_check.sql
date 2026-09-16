-- ============================================================================
-- Migrasi: Penyesuaian Check Constraint sync_status pada Tabel Penerima
-- ============================================================================
-- Mengizinkan nilai 'SUKSES' dan 'BERHASIL' sebagai status sinkronisasi penerima
-- untuk mencegah penolakan insert dan menjaga kompatibilitas ke depan.

alter table penerima drop constraint if exists penerima_sync_status_check cascade;
alter table penerima add constraint penerima_sync_status_check check (sync_status in ('PENDING', 'SUKSES', 'GAGAL', 'BERHASIL'));
