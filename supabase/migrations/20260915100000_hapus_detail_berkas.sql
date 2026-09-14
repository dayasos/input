-- Fitur "Data Detail" (tombol per-baris di tab Lihat Data yang menampilkan sheet eksternal
-- "Data Detail") dihapus total dari aplikasi (frontend index.html, backend Kode.gs, dan stub
-- Supabase ambilDataDetailByNik) — 2026-09-15. Tabel ini kosong (job sinkronisasi dari sheet
-- eksternal belum pernah dibangun) sehingga aman didrop tanpa kehilangan data.
drop table if exists detail_berkas;
