-- ============================================================
-- SETELAN (pengganti db_setelan: kolom A=Key, B=Value)
-- Contoh key: 'INPUT_KECAMATAN_KEMENAG' (sakelar master), 'INPUT_USER_<USER_ID>' (override per-user)
-- ============================================================
create table if not exists setelan (
  key   text primary key,
  value text not null
);

-- ============================================================
-- RIWAYAT SETELAN (pengganti db_riwayat_setelan)
-- Kolom asli: Waktu, Username, Key, Nilai Lama, Nilai Baru, Keterangan
-- ============================================================
create table if not exists riwayat_setelan (
  id          bigserial primary key,
  waktu       timestamptz not null default now(),
  username    text not null,
  key         text not null,
  nilai_lama  text,
  nilai_baru  text,
  keterangan  text default ''
);
create index if not exists idx_riwayat_setelan_key on riwayat_setelan(key, waktu desc);

-- ============================================================
-- RIWAYAT EDIT (pengganti db_riwayat_edit)
-- Kolom asli: Waktu, Editor, Role, No.Baris, Nama Penerima, Kolom Diubah, Sebelum, Sesudah
-- No.Baris (nomor baris fisik di sheet) diganti referensi ke penerima(id, tahun); nomor_baris_sheet
-- disimpan sebagai jejak historis begitu baris sudah tersinkron ke Sheets.
-- ============================================================
create table if not exists riwayat_edit (
  id                bigserial primary key,
  waktu             timestamptz not null default now(),
  editor_username   text not null,
  editor_role       text not null,
  penerima_id       bigint,
  tahun             int,
  nomor_baris_sheet int,
  nama_penerima     text,
  kolom_diubah      text not null,
  sebelum           text,
  sesudah           text
);
create index if not exists idx_riwayat_edit_penerima on riwayat_edit(tahun, penerima_id);

-- Catatan: tabel chat_pesan/chat_dibaca (pengganti db_chat & db_chat_baca) SENGAJA tidak
-- dibuat — fitur chat grup dihapus dari aplikasi (Kode.gs & index.html) atas permintaan user
-- 2026-09-12, jadi tidak perlu diporting ke Supabase.
