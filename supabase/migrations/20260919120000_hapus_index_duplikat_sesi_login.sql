-- Hapus 2 index duplikat di sesi_login yang ditambah tanpa sadar migrasi ini sudah dipenuhi
-- constraint/index lain:
--   - idx_sesi_login_token (20260917210000_performa_index_dan_warmup.sql) duplikat PRIMARY KEY
--     `token` di sesi_login (20260907090000_extensions_akun_sesi.sql baris 29) -- PRIMARY KEY
--     otomatis unique-indexed, index tambahan ini nol manfaat baca, cuma nambah overhead tulis
--     di setiap buatSesi()/hapusSesi().
--   - idx_sesi_login_kedaluwarsa (20260917210000) duplikat idx_sesi_kedaluwarsa yang sudah ada
--     sejak 20260907090000_extensions_akun_sesi.sql baris 38, kolom sama persis (kedaluwarsa_at).
drop index if exists idx_sesi_login_token;
drop index if exists idx_sesi_login_kedaluwarsa;
