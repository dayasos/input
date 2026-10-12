-- ============================================================
-- RETUR TERINTEGRASI (pengganti aplikasi Retur lama: Apps Script + Google Sheets).
-- Keputusan user 2026-10-11: Retur jadi bagian aplikasi Input, tanpa SSO, mulai bersih 2027.
-- DRAFT LOKAL -- BELUM dijalankan di produksi.
--
-- TANPA FOREIGN KEY ke data_detail/penerima (sengaja, sama dengan pembayaran_baris): data_detail BISA dihapus oleh proses lain
-- (sinkronSheet2026 menghapus baris yang statusnya tidak lagi lolos; kelolaData menghapus penerima). Dengan FK, penghapusan itu
-- gagal dan membatalkan seluruh transaksi sinkron. `data_detail_id` hanya penunjuk informasional; identitas penerima disimpan
-- sebagai SALINAN di tiap tabel (nik, nama, layanan, kecamatan, kelurahan, tempat_tugas) sehingga riwayat uang tetap utuh.
--
-- Prinsip:
--  * `data_detail.status/tgl_status` tetap satu-satunya sumber status penerima.
--  * Identitas penerima (nama, layanan, kecamatan, kelurahan, ...) tidak diketik ulang: tabel
--    retur menyimpan `data_detail_id` + salinan beku untuk dokumen (pola `pembayaran_baris`).
--  * Riwayat bersifat append-only; dokumen Bendahara = snapshot beku per versi.
--  * Bulan disimpan sebagai teks "JANUARI".."DESEMBER" (sama dengan `pembayaran_batch.bulan`).
--  * Semua tabel: RLS aktif tanpa policy (akses hanya lewat Edge Function, service role).
-- ============================================================

-- Nama bulan seragam dengan `pembayaran_batch.bulan`; domain supaya salah ketik ditolak di database.
do $$ begin
  create domain bulan_retur as text check (value in (
    'JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI',
    'JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'));
exception when duplicate_object then null; end $$;

-- ---------- Referensi ----------
create table if not exists ref_jenis_perbaikan (
  kode    text primary key,
  urutan  int not null
);
insert into ref_jenis_perbaikan (kode, urutan) values
  ('REKENING SALAH', 1),
  ('GANTI NOMOR REKENING', 2),
  ('DORMAN ATAU AKTIVASI REKENING', 3),
  ('NAMA PADA REKENING SALAH', 4)
on conflict (kode) do nothing;

-- khusus_utama: hanya boleh dipakai peran UTAMA (menggantikan token HMAC di Retur lama).
create table if not exists ref_status_laporan (
  kode          text primary key,
  khusus_utama  boolean not null default false,
  urutan        int not null
);
insert into ref_status_laporan (kode, khusus_utama, urutan) values
  ('MENINGGAL DUNIA', false, 1),
  ('MENGUNDURKAN DIRI', false, 2),
  ('SUDAH TIDAK AKTIF', false, 3),
  ('PERGANTIAN PENGURUS', false, 4),
  ('ASN/P3K', false, 5),
  ('LAINNYA', false, 6),
  ('HASIL MONEV TAHUN 2027', true, 7),
  ('TIDAK MENYERAHKAN LAPORAN KEGIATAN SEMESTER', true, 8)
on conflict (kode) do nothing;

-- ---------- Impor Excel rekening retur dari bank ----------
create table if not exists retur_impor (
  id                  bigserial primary key,
  tahun               int not null,
  bulan               bulan_retur not null,
  nama_file           text,
  jumlah_baris        int not null default 0,
  jumlah_cocok        int not null default 0,
  jumlah_tidak_cocok  int not null default 0,
  diunggah_oleh_akun_id uuid references akun(id),
  dibuat_at           timestamptz not null default now()
);

-- Daftar penerima yang transfernya retur pada bulan tsb (= file "Retur Pembayaran Bulan X").
-- Kolom identitas adalah salinan beku saat impor (dokumen untuk kecamatan).
create index if not exists ix_retur_impor_bulan on retur_impor (tahun, bulan);

create table if not exists retur_daftar (
  id               bigserial primary key,
  tahun            int not null,
  bulan            bulan_retur not null,
  data_detail_id   bigint not null,
  impor_id         bigint references retur_impor(id) on delete set null,

  nama_rekening    text,
  nik              text not null,
  jenis_kelamin    text,
  alamat           text,
  layanan          text not null,
  nomor_rekening   text,
  kecamatan        text,
  kelurahan        text,
  tempat_tugas     text,
  no_kontak        text,
  dibuat_at        timestamptz not null default now(),

  unique (tahun, bulan, data_detail_id)
);
create index if not exists ix_retur_daftar_nik on retur_daftar (tahun, nik);

-- Baris di file bank yang rekeningnya tidak ditemukan di data_detail ("REKENING TIDAK DITEMUKAN").
create table if not exists retur_rek_tidak_ditemukan (
  id              bigserial primary key,
  impor_id        bigint not null references retur_impor(id) on delete cascade,
  nomor_rekening  text,
  nama            text
);

-- ---------- Laporan perbaikan rekening dari kecamatan/kelurahan/Kemenag ----------
create index if not exists ix_retur_rek_tdk_impor on retur_rek_tidak_ditemukan (impor_id);

create table if not exists retur_laporan (
  id               bigserial primary key,
  tahun            int not null,
  bulan            bulan_retur not null,
  data_detail_id   bigint not null,

  nik              text not null,
  nama             text not null,
  layanan          text not null,
  kecamatan        text,
  kelurahan        text,
  tempat_tugas     text,

  jenis_perbaikan  text not null references ref_jenis_perbaikan(kode),
  rekening_lama    text,
  rekening_baru    text,
  nama_rekening    text,
  no_kontak        text,
  nama_pelapor     text,
  jabatan          text,
  url_ktp          text,
  url_buku         text,

  dibuat_oleh_akun_id uuid references akun(id),
  dibuat_at        timestamptz not null default now()
);
create index if not exists ix_retur_laporan_bulan on retur_laporan (tahun, bulan, data_detail_id, dibuat_at desc);

-- ---------- Proses perbaikan (status kerja per penerima per bulan) ----------
create table if not exists retur_proses (
  id               bigserial primary key,
  tahun            int not null,
  bulan            bulan_retur not null,
  data_detail_id   bigint not null,
  laporan_id       bigint references retur_laporan(id) on delete set null,

  nomor_perbaikan  int,   -- "ke-n" dalam bulan itu
  status_kerja     text not null
                   check (status_kerja in ('PROSES PEMBAYARAN', 'SUDAH DIBAYARKAN', 'KENDALA')),
  kendala          text
                   check (kendala is null or kendala in (
                     'REKENING DALAM STATUS TUTUP', 'REKENING DALAM STATUS DORMAN',
                     'NAMA DI REKENING BERBEDA', 'REKENING TIDAK DITEMUKAN')),
  diubah_oleh_akun_id uuid references akun(id),
  diubah_at        timestamptz not null default now(),

  unique (tahun, bulan, data_detail_id)
);

-- Append-only: tiap perubahan proses menambah satu baris (tidak pernah di-update/delete).
create table if not exists retur_riwayat (
  id               bigserial primary key,
  proses_id        bigint not null references retur_proses(id) on delete restrict,
  waktu            timestamptz not null default now(),
  oleh_akun_id     uuid references akun(id),
  oleh_nama        text,   -- salinan beku nama operator (tampil di log, tetap terbaca bila akun dihapus)
  aksi             text not null,
  nomor_perbaikan  int,
  kendala          text,
  catatan          text
);
create index if not exists ix_retur_riwayat_proses on retur_riwayat (proses_id, waktu);

-- Penegak append-only: riwayat tidak boleh diubah atau dihapus (FK ke retur_proses `restrict`, jadi
-- proses yang sudah punya riwayat pun tidak bisa dihapus). Koreksi dilakukan dengan menambah baris baru.
create or replace function retur_riwayat_tolak_ubah() returns trigger
language plpgsql as $$
begin
  raise exception 'retur_riwayat bersifat append-only: % tidak diizinkan', tg_op;
end $$;
drop trigger if exists trg_retur_riwayat_append_only on retur_riwayat;
create trigger trg_retur_riwayat_append_only
  before update or delete on retur_riwayat
  for each row execute function retur_riwayat_tolak_ubah();

-- ---------- Dokumen untuk Bendahara (snapshot beku, per versi) ----------
create table if not exists retur_bendahara_batch (
  id                  bigserial primary key,
  tahun               int not null,
  bulan               bulan_retur not null,
  nomor_perbaikan     int not null,
  dibuat_oleh_akun_id uuid references akun(id),
  dibuat_at           timestamptz not null default now(),
  -- hasil mirroring ke Google Drive (diisi setelah berhasil)
  url_drive           text,
  mirror_at           timestamptz,
  mirror_galat        text,

  unique (tahun, bulan, nomor_perbaikan)
);

-- Tanpa foreign key ke data_detail: snapshot harus berdiri sendiri (pola pembayaran_baris).
create table if not exists retur_bendahara_baris (
  id              bigserial primary key,
  batch_id        bigint not null references retur_bendahara_batch(id) on delete cascade,
  data_detail_id  bigint,
  nama            text not null,
  nik             text not null,
  layanan         text not null,
  nomor_rekening  text,
  jumlah          bigint not null   -- nilai pembayaran sebenarnya (tetap per layanan, bukan kompensasi umur)
);
create index if not exists ix_retur_bendahara_baris_batch on retur_bendahara_baris (batch_id);

-- ---------- Laporan status penerima (meninggal/tidak aktif/dst + aktivasi kembali) ----------
create table if not exists status_penerima_laporan (
  id               bigserial primary key,
  tahun            int not null,
  data_detail_id   bigint not null,

  nik              text not null,
  nama             text not null,
  layanan          text not null,
  kecamatan        text,
  kelurahan        text,
  tempat_tugas     text,

  jenis            text not null default 'NONAKTIF' check (jenis in ('NONAKTIF', 'AKTIVASI')),
  status_laporan   text not null,          -- salah satu ref_status_laporan.kode, atau 'AKTIF' utk AKTIVASI
  status_sebelum   text,
  tanggal          date,
  detail           text,
  url_dokumen      text,
  nama_pelapor     text,
  jabatan          text,

  dibuat_oleh_akun_id uuid references akun(id),
  dibuat_at        timestamptz not null default now()
);
create index if not exists ix_status_laporan_nik on status_penerima_laporan (tahun, nik, dibuat_at desc);

-- ---------- RLS (wajib di migrasi yang sama; tanpa policy = hanya service role) ----------
alter table ref_jenis_perbaikan        enable row level security;
alter table ref_status_laporan         enable row level security;
alter table retur_impor                enable row level security;
alter table retur_daftar               enable row level security;
alter table retur_rek_tidak_ditemukan  enable row level security;
alter table retur_laporan              enable row level security;
alter table retur_proses               enable row level security;
alter table retur_riwayat              enable row level security;
alter table retur_bendahara_batch      enable row level security;
alter table retur_bendahara_baris      enable row level security;
alter table status_penerima_laporan    enable row level security;
