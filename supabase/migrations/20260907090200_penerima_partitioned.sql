-- ============================================================
-- PENERIMA (pengganti sheet "Data Input <tahun>", partisi per tahun)
-- Header sheet asli (dikonfirmasi dari simpanDataKeSheet() di Kode.gs, appendRow saat sheet baru):
--   NO, NAMA, NIK, JENIS KELAMIN, TEMPAT LAHIR, TANGGAL LAHIR, ALAMAT,
--   LAYANAN, TEMPAT TUGAS, ALAMAT TUGAS, KECAMATAN, KELURAHAN,
--   NAMA REKENING, NOMOR REKENING, KANTOR CABANG, NO. KONTAK, STATUS BPJS TK, UMUR,
--   LINK KTP, LINK BUKU REKENING, LINK SURAT PERMOHONAN, LINK PERNYATAAN SATU BANTUAN,
--   LINK DOMISILI KELURAHAN, LINK FORMULIR PENDATAAN, LINK BERKAS PENDUKUNG,
--   LINK FOTO PLANK RUMAH IBADAH, LINK FOTO LOKASI IBADAH, LINK FOTO KEGIATAN BELAJAR,
--   LINK REKOMENDASI BKM, LINK REKOMENDASI RUMAH IBADAH, ID FOLDER BERKAS, LINK KOORDINAT LOKASI,
--   STATUS VERIFIKASI, KETERANGAN VERIFIKASI, TANGGAL VERIFIKASI, DIVERIFIKASI OLEH, BATAS WAKTU PERBAIKAN,
--   CATATAN PERBEDAAN NAMA, TANGGAL LAPOR PERBAIKAN, DILAPOR OLEH
--
-- Dipartisi per tahun (bukan tabel independen seperti pola db_2025/db_2026 di Sheets) karena
-- kode lama butuh query lintas-tahun (cekStatusTahunLalu_, ambilDataTahunHakAkses) — dengan partisi
-- ini jadi satu query yang di-prune otomatis oleh planner, bukan UNION manual ke N tabel.
-- ============================================================
create table if not exists penerima (
  id                      bigserial,
  tahun                   int not null,
  nomor_urut              int not null,               -- kolom "NO" lama, per-tahun

  nama                    text not null,
  nik                     text not null,
  jenis_kelamin           text,
  tempat_lahir            text,
  tanggal_lahir           date,
  alamat                  text,

  layanan                 text not null,
  tempat_tugas            text,
  alamat_tugas            text,
  kecamatan               text not null,
  kelurahan               text,

  nama_rekening           text,
  nomor_rekening          text not null,
  kantor_cabang           text,
  no_kontak               text,
  status_bpjs_tk          text,
  umur                    int,

  -- 12 kolom link berkas Google Drive
  link_ktp                     text,
  link_buku_rekening           text,
  link_surat_permohonan        text,
  link_pernyataan_satu_bantuan text,
  link_domisili_kelurahan      text,
  link_formulir_pendataan      text,
  link_berkas_pendukung        text,
  link_foto_plank_rumah_ibadah text,
  link_foto_lokasi_ibadah      text,
  link_foto_kegiatan_belajar   text,
  link_rekomendasi_bkm         text,
  link_rekomendasi_rumah_ibadah text,
  id_folder_berkas             text,
  link_koordinat_lokasi        text,

  status_verifikasi       text not null default 'Proses Verifikasi',
  keterangan_verifikasi   text,
  tanggal_verifikasi      timestamptz,
  diverifikasi_oleh       text,
  batas_waktu_perbaikan   date,
  catatan_perbedaan_nama  text,
  tanggal_lapor_perbaikan timestamptz,
  dilapor_oleh            text,

  -- kolom teknis migrasi/sinkron (tidak ada di Sheets asli)
  dibuat_oleh_akun_id     uuid references akun(id),
  dibuat_at               timestamptz not null default now(),
  diperbarui_at           timestamptz not null default now(),
  sheet_row_number        int,                        -- baris asli di "Data Input <tahun>" setelah sync sukses
  sync_status             text not null default 'PENDING' check (sync_status in ('PENDING', 'SUKSES', 'GAGAL')),

  primary key (id, tahun)
) partition by list (tahun);

-- Partisi tahun aktif (selaras NAMA_SHEET_INPUT = "Data Input 2027")
create table if not exists penerima_2027 partition of penerima for values in (2027);

-- PENTING: index dibuat di tabel INDUK (penerima), bukan di partisi anak (penerima_2027).
-- Sejak Postgres 11, index yang dibuat di tabel partisi induk otomatis dibuatkan padanannya
-- di semua partisi yang sudah ada, DAN otomatis diwariskan ke setiap partisi baru yang dibuat
-- dengan "... PARTITION OF penerima ...". Dengan begitu, saat pergantian tahun (mis. 2028) kita
-- CUKUP membuat partisi barunya saja — tidak perlu mengingat untuk membuat ulang index/constraint,
-- yang kalau lupa bisa berarti duplikasi NIK/rekening lolos tanpa terdeteksi.
create unique index if not exists uq_penerima_nik on penerima (tahun, nik);
-- Partial index (kecualikan rekening kosong): replikasi getIndeksTerdaftar_() di Kode.gs yang
-- SENGAJA tidak mengindeks rekening kosong ("if (rek) dataMap.rek[rek] = nama") sehingga data lama
-- yang belum lengkap rekeningnya tidak saling dianggap duplikat satu sama lain — ditemukan saat
-- code review (tanpa WHERE ini, backfill data arsip akan gagal begitu ada 2+ baris rekening kosong).
create unique index if not exists uq_penerima_rekening on penerima (tahun, nomor_rekening)
  where nomor_rekening <> '';
-- Replikasi LAYANAN_BATASI_TEMPAT_TUGAS: hanya layanan berikut dibatasi 1 penerima/tempat tugas
create unique index if not exists uq_penerima_tempat_tugas on penerima (tahun, layanan, tempat_tugas, alamat_tugas)
  where layanan in ('IMAM MASJID', 'NAZIR MASJID', 'NAZIR MUSHOLLA', 'PENGURUS GEREJA', 'PENGURUS VIHARA/KLENTENG/KUIL');
create unique index if not exists uq_penerima_nomor_urut on penerima (tahun, nomor_urut);
create index if not exists idx_penerima_kec_lay on penerima (kecamatan, layanan);
create index if not exists idx_penerima_status on penerima (status_verifikasi);
create index if not exists idx_penerima_sync on penerima (sync_status) where sync_status <> 'SUKSES';

-- Catatan: saat pergantian tahun (mis. 2028), CUKUP jalankan:
--   create table penerima_2028 partition of penerima for values in (2028);
-- Semua unique index & constraint di atas otomatis berlaku untuk partisi baru itu juga.

-- ============================================================
-- DETAIL BERKAS (mirror READ-ONLY dari sheet "Data Detail", diisi pihak lain via job tarik terjadwal)
-- Kolom asli: A..S (belum diinventarisasi detail per-kolom — isi sesuai header asli saat job sync dibuat)
--
-- PENTING (diperbaiki saat code review): sheet ini 1-NIK-BANYAK-BARIS, bukan 1-NIK-1-BARIS —
-- ambilDataDetailByNik() di Kode.gs meloop dan mengembalikan SEMUA baris yang cocok NIK-nya (dan
-- UI modalnya memang dibangun untuk menampilkan daftar, bukan satu hasil). `unique (nik)` semula
-- di sini akan diam-diam menghilangkan baris ke-2/ke-3 dst saat job sync (belum dibangun) upsert
-- per NIK. Kunci unik yang benar adalah posisi baris fisik di sheet (`sheet_row_number`, sama
-- pola dengan `penerima.sheet_row_number`) — itulah identitas yang stabil untuk upsert idempoten.
-- ============================================================
create table if not exists detail_berkas (
  id                bigserial primary key,
  nik               text not null,
  sheet_row_number  int not null,
  data              jsonb not null default '{}',   -- simpan seluruh baris apa adanya (kolom A..S) sampai skema final dikonfirmasi
  ditarik_at        timestamptz not null default now(),
  unique (sheet_row_number)
);
create index if not exists idx_detail_berkas_nik on detail_berkas (nik);
