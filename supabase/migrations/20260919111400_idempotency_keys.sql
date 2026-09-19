-- Migration: Tabel idempotency_keys untuk mencegah data dobel saat retry simpan
-- Dibuat: 2026-09-19
-- Tujuan: menyimpan kunci unik sekali pakai yang dikirim browser saat simpan data penerima.
-- Jika request pertama berhasil (sukses=true) tapi koneksi putus sebelum respons balik ke browser,
-- retry berikutnya dengan kunci yang sama akan langsung mendapat respons sukses tanpa tulis ulang.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT PRIMARY KEY,
  result     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Edge Function pakai koneksi Postgres langsung (SUPABASE_DB_URL), melewati RLS.
-- Tabel ini tidak perlu diekspos via REST API publik.
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- CATATAN: Untuk pembersihan otomatis record lama (>15 menit), aktifkan pg_cron di Supabase Dashboard
-- (Database > Extensions > pg_cron), kemudian jalankan perintah ini di SQL Editor:
--   SELECT cron.schedule('bersihkan-idempotency-keys', '*/15 * * * *',
--     $$DELETE FROM idempotency_keys WHERE created_at < now() - interval '15 minutes'$$);
