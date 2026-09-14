-- ============================================================
-- LAYANAN MASTER (pengganti db_layanan: kolom A=Kecamatan-layanan, B=Kemenag-layanan)
-- ============================================================
create table if not exists layanan_master (
  id           bigserial primary key,
  kategori     text not null check (kategori in ('KECAMATAN', 'KEMENAG')),
  nama_layanan text not null,
  urutan       int not null default 0,     -- pertahankan urutan tampil asli di dropdown (baris sheet)
  unique (kategori, nama_layanan)
);

-- ============================================================
-- WILAYAH (pengganti db_wilayah: kolom A=Kecamatan, B=Kelurahan)
-- ============================================================
create table if not exists wilayah (
  id        bigserial primary key,
  kecamatan text not null,
  kelurahan text not null,
  unique (kecamatan, kelurahan)
);
create index if not exists idx_wilayah_kecamatan on wilayah(kecamatan);

-- ============================================================
-- KUOTA (pengganti db_kuota: kolom A=Kecamatan, B=Layanan, C=Kuota)
-- KUOTA KATOLIK (pengganti db_kuotakatolik, struktur sama - subset kuota GSM utk Katolik)
-- ============================================================
create table if not exists kuota (
  id         bigserial primary key,
  kecamatan  text not null,
  layanan    text not null,
  kuota_maks int not null default 0,
  diperbarui_at timestamptz not null default now(),
  unique (kecamatan, layanan)
);

create table if not exists kuota_katolik (
  id         bigserial primary key,
  kecamatan  text not null,
  layanan    text not null,
  kuota_maks int not null default 0,
  diperbarui_at timestamptz not null default now(),
  unique (kecamatan, layanan)
);

-- ============================================================
-- RUMAH IBADAH (unifikasi db_masjid/db_musholla/db_gereja/db_pgk/db_vihara_klenteng_kuil)
-- Kolom asli tiap sheet (1-based): A=Kecamatan B=Kelurahan C=Nama D=Alamat
-- (dikonfirmasi dari renderTable() di index.html: r[0]=kecamatan, r[1]=kelurahan, r[2]=nama, r[3]=alamat)
-- ============================================================
create table if not exists rumah_ibadah (
  id         bigserial primary key,
  jenis      text not null check (jenis in ('MASJID', 'MUSHOLLA', 'GEREJA', 'PGK', 'VIHARA_KLENTENG_KUIL', 'VIHARA', 'KUIL')),
  kecamatan  text not null,
  kelurahan  text not null,
  nama       text not null,
  alamat     text not null default ''
);
create index if not exists idx_rumah_ibadah_jenis_kec on rumah_ibadah(jenis, kecamatan);

-- ============================================================
-- CAPIL (pengganti db_capil - whitelist domisili luar Kota Medan)
-- Kolom asli (1-based): A=NAMA B=NIK C=JK D=TMPT LAHIR E=TGL LAHIR F=ALAMAT
--   G=KECAMATAN H=KELURAHAN I=STATUS J=ALAMAT DOMISILI K=KAB/KOTA DOMISILI
-- Semantik dipertahankan: NIK DITEMUKAN di tabel ini = berdomisili di luar Kota Medan -> tolak input.
-- ============================================================
create table if not exists capil (
  id                bigserial primary key,
  nik               text not null,
  nama              text,
  jenis_kelamin     text,
  tempat_lahir      text,
  tanggal_lahir     date,
  alamat            text,
  kecamatan         text,
  kelurahan         text,
  status            text,
  alamat_domisili   text,
  kab_kota_domisili text,
  unique (nik)
);
