-- ============================================================
-- BUCKET STORAGE "berkas-penerima" -- pengganti Google Drive untuk upload berkas penerima
-- (KTP, buku rekening, foto, dsb). Keputusan 2026-09-15: karena data & berkas saat ini masih
-- kosong, migrasi langsung total (bukan hybrid mempertahankan Drive untuk berkas lama) --
-- tidak ada link Drive lama yang perlu tetap didukung.
--
-- PRIVAT (public = false) -- berkasnya PII sensitif (KTP, buku rekening). Hanya Edge Function
-- (lewat Service Role Key) yang bisa upload/baca langsung; frontend TIDAK PERNAH bicara ke
-- Storage API secara langsung. Setiap upload menghasilkan signed URL berumur sangat panjang
-- (~10 tahun, lihat _shared/storage.ts) yang disimpan sebagai link permanen di kolom
-- `penerima.link_*` -- bucket tetap privat (tidak bisa ditelusuri/ditebak orang lain), tapi
-- link yang tersimpan tetap berfungsi tanpa perlu digenerate ulang, meniru perilaku link
-- Drive lama supaya index.html tidak perlu berubah cara menyimpan/menampilkan link berkas.
--
-- file_size_limit & allowed_mime_types di sini SAMA PERSIS MAKS_BYTE_PER_BERKAS (25 MB) &
-- MIME_BERKAS_DIIZINKAN di Kode.gs -- lapis pertahanan kedua di level bucket, selain validasi
-- yang sudah dilakukan di domains/upload.ts (defense-in-depth, bukan pengganti).
--
-- Tidak perlu policy RLS di storage.objects -- persis pola yang sudah dipakai tabel `public.*`
-- di proyek ini (RLS aktif dgn nol policy): satu-satunya pemegang akses adalah Service Role Key
-- dari Edge Function, yang otomatis melewati RLS/kebijakan bucket privat.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'berkas-penerima',
  'berkas-penerima',
  false,
  26214400, -- 25 MB
  array[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'image/bmp', 'image/gif',
    'application/pdf'
  ]
)
on conflict (id) do nothing;
