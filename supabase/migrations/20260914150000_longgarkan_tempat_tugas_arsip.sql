-- ============================================================
-- Longgarkan constraint unik tempat-tugas KHUSUS untuk partisi arsip (bukan tahun aktif)
-- ============================================================
-- Ditemukan saat backfill db_2026 -> penerima_2026 (2026-09-14): 3 pasang baris bentrok nyata
-- (2 nazir masjid berbeda tercatat untuk masjid yang sama) -- kemungkinan pergantian nazir di
-- tengah tahun 2026 yang tidak tervalidasi ketat saat itu. Constraint uq_penerima_tempat_tugas
-- (1 penerima per tempat-tugas untuk layanan tertentu) memang dirancang untuk mencegah duplikat
-- SAAT INPUT DATA BARU di tahun aktif -- data arsip cuma referensi historis dibaca lewat
-- cekStatusTahunLalu_/ambilDataTahunHakAkses, tidak pernah divalidasi ulang terhadap constraint
-- ini. Dikonfirmasi user: longgarkan untuk arsip, TETAP ketat untuk tahun aktif.
--
-- PENCOBAAN AWAL GAGAL: `ALTER INDEX ... DETACH PARTITION` yang dikira bisa melepas index dari
-- SATU partisi ternyata TIDAK ADA di PostgreSQL (dokumentasi resmi cuma punya ATTACH PARTITION;
-- index yang sudah ter-attach ke index induk partisi TIDAK BISA di-drop sendiri-sendiri). Jadi
-- constraint ini dipindah dari tabel INDUK ke partisi penerima_2027 SECARA LANGSUNG -- bukan lagi
-- otomatis terwarisi ke semua partisi baru seperti index lain.
--
-- KONSEKUENSI untuk pergantian tahun berikutnya (mis. 2028 jadi aktif): index ini TIDAK ikut
-- otomatis dibuat untuk penerima_2028 seperti index umum lainnya -- harus dibuat manual di migrasi
-- saat itu (create unique index ... on penerima_2028 (...) where layanan in (...)), sama seperti
-- RLS yang juga harus eksplisit per-partisi (lihat 20260914130000_enable_rls_partisi_penerima.sql).
-- Ini SENGAJA, bukan kealpaan -- sejalan dengan keputusan "arsip longgar, tahun aktif ketat".
drop index uq_penerima_tempat_tugas;

create unique index if not exists uq_penerima_2027_tempat_tugas on penerima_2027
  (tahun, layanan, tempat_tugas, alamat_tugas)
  where layanan in ('IMAM MASJID', 'NAZIR MASJID', 'NAZIR MUSHOLLA', 'PENGURUS GEREJA', 'PENGURUS VIHARA/KLENTENG/KUIL');
