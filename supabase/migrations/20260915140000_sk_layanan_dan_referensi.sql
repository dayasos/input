-- ============================================================
-- SK PER LAYANAN + REFERENSI SK WALI KOTA (halaman "Tools", khusus UTAMA)
--
-- Ditemukan lewat perbandingan langsung dengan contoh dokumen resmi 2026: sheet REKAP asli
-- punya kolom "SK" yang berisi total penerima per layanan SESUAI SURAT KEPUTUSAN -- BUKAN
-- dihitung ulang otomatis tiap kali laporan dibuat, melainkan angka TETAP yang diisi manual
-- sekali (saat SK terbit) dan sejak itu dianggap PERMANEN sampai memang ada revisi SK baru.
-- Beda sifatnya dari `pembayaran_baris.jumlah_diterima` dkk (yang memang dihitung ulang tiap
-- bulan dari data AKTIF terkini) -- jangan disatukan logikanya dengan snapshot pembayaran.
--
-- `jumlah_sk` SENGAJA nullable (bukan default 0) -- 0 dan "belum diisi" adalah 2 hal yang
-- beda maknanya di dokumen resmi (lihat cara unduhExcelBatch menampilkan "-" utk NULL).
-- ============================================================
create table if not exists sk_layanan (
  layanan_kode   text primary key,
  jumlah_sk      int,
  diperbarui_at  timestamptz not null default now()
);

-- Diseed dengan seluruh 16 kode layanan, jumlah_sk masih NULL (pendataan 2027 belum mulai
-- saat migration ini ditulis) -- diisi manual nanti lewat halaman Tools begitu SK terbit.
insert into sk_layanan (layanan_kode) values
  ('BILAL'), ('GMM'), ('GSB'), ('GSH'), ('GSM'), ('IMAM'), ('KHATIB'),
  ('N. MASJID'), ('N. MUSHOLLA'), ('PENATUA'), ('P. KUBUR'), ('P. GEREJA'),
  ('P. KUIL'), ('PGK'), ('USTADZ'), ('USTADZAH')
on conflict (layanan_kode) do nothing;

-- Referensi "BERDASARKAN SK WALI KOTA MEDAN NOMOR : ... TGL ..." di judul dokumen resmi --
-- SATU baris singleton (id selalu 1), nomor & tanggal SENGAJA nullable karena belum ada saat
-- migration ini ditulis (pendataan 2027 belum mulai). unduhExcelBatch menampilkan placeholder
-- jelas "(BELUM DITETAPKAN)" kalau masih kosong -- bukan disembunyikan atau dikosongkan begitu
-- saja, supaya siapa pun yang buka dokumennya sadar itu masih perlu dilengkapi.
create table if not exists referensi_sk_walikota (
  id             int primary key default 1,
  nomor_sk       text,
  tanggal_sk     date,
  diperbarui_at  timestamptz not null default now(),

  constraint referensi_sk_walikota_singleton check (id = 1)
);
insert into referensi_sk_walikota (id) values (1) on conflict (id) do nothing;

alter table sk_layanan enable row level security;
alter table referensi_sk_walikota enable row level security;
