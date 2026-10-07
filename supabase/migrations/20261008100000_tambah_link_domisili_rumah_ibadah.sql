-- Berkas baru "Unggah Domisili Rumah Ibadah" (wajib utk IMAM MASJID, NAZIR MASJID, NAZIR MUSHOLLA,
-- PENGURUS GEREJA, PENGURUS VIHARA/KLENTENG/KUIL). Kolom ditaruh di ujung (indeks posisional 40)
-- supaya posisi 0..39 yang dipakai kode & sheet tidak bergeser. Partisi penerima_<tahun> ikut otomatis.
-- Baris lama sengaja dibiarkan NULL (tidak ada backfill).
alter table penerima add column if not exists link_domisili_rumah_ibadah text;
