-- ============================================================
-- DATA DETAIL (pengganti sheet "Data Detail" + formula QUERY() yang sebelumnya menariknya
-- dari sheet "Data Input <tahun>") -- keputusan 2026-09-15: aplikasi ini berhenti total
-- memakai Google Sheets untuk fitur ini, murni Supabase.
--
-- Beda dari `penerima`: tabel ini HANYA berisi baris yang sudah berstatus verifikasi
-- "Memenuhi Syarat" (bukan semua status), dan punya siklus status SENDIRI (`status` +
-- `tgl_status`) yang independen dari `penerima.status_verifikasi` -- dipakai nanti oleh
-- alur Pembayaran (tarik yang `status = 'AKTIF'`) dan diisi/diubah oleh Aplikasi Retur
-- (laporan meninggal/tidak aktif/mengundurkan diri, dst). Aplikasi Input ini TIDAK PERNAH
-- menulis kolom `status`/`tgl_status` setelah baris dibuat -- itu wewenang Aplikasi Retur
-- begitu nanti sudah tersambung ke database yang sama.
--
-- Kolom "NO" pada sheet lama SENGAJA tidak disimpan di sini -- itu cuma nomor urut tampilan
-- (posisi baris pada hasil filter), dihitung ulang di frontend saat render (pola yang sama
-- persis dipakai tabel Lihat Data: `nomorUrut++`), bukan identitas yang perlu disimpan.
-- ============================================================
create table if not exists data_detail (
  id                bigserial,
  tahun             int not null,
  penerima_id       bigint not null,

  nama              text not null,
  nik               text not null,
  jenis_kelamin     text,
  tempat_lahir      text,
  tanggal_lahir     date,
  alamat            text,
  layanan           text not null,
  tempat_tugas      text,
  alamat_tugas      text,
  kecamatan         text not null,
  kelurahan         text,
  nama_rekening     text,
  nomor_rekening    text,
  kantor_cabang     text,
  no_kontak         text,
  status_bpjs_tk    text,
  umur              int,

  -- Siklus status independen -- diisi/diubah Aplikasi Retur. Sengaja teks bebas (bukan
  -- check-constraint ke daftar nilai tetap) karena kosakata form pelapor Retur belum
  -- dikonfirmasi persis -- lebih aman menerima apa adanya daripada menolak tulisan yang
  -- sah cuma karena beda dari tebakan kita.
  status            text not null default 'AKTIF',
  tgl_status        timestamptz not null default now(),

  dibuat_at         timestamptz not null default now(),
  diperbarui_at     timestamptz not null default now(),

  primary key (id, tahun),
  foreign key (penerima_id, tahun) references penerima (id, tahun)
) partition by list (tahun);

create table if not exists data_detail_2027 partition of data_detail for values in (2027);

-- Index dibuat di tabel INDUK (bukan di partisi anak) -- otomatis diwariskan ke partisi baru
-- setiap pergantian tahun, sama pola dengan `penerima` (lihat catatan di migrasi
-- 20260907090200_penerima_partitioned.sql).
create unique index if not exists uq_data_detail_penerima on data_detail (tahun, penerima_id);
create index if not exists idx_data_detail_status on data_detail (tahun, status);
create index if not exists idx_data_detail_nik on data_detail (nik);
create index if not exists idx_data_detail_kec_lay on data_detail (kecamatan, layanan);

alter table data_detail enable row level security;
